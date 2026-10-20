/**
 * PROCEDURE DIVISION rules: CALL (001, 002), dynamic SQL (003), DISPLAY of
 * sensitive data (005), MOVE sign loss / truncation (006-008), arithmetic
 * without ON SIZE ERROR or ROUNDED (009, 010, 013) and ALTER (015).
 */
import { cobolMoneyStrength, isCobolSensitiveName } from '../names.mjs';
import { escapeInvisible } from '../text.mjs';
import {
  addBounds, expressionBound, fitsIntegerDigits, itemBound, literalBound, multiplyBounds, parseNumericLiteral,
} from './bounds.mjs';
import { FIGURATIVES } from './symbols.mjs';
import {
  arithmeticSegments, hasSizeError, isPunct, isWord, parseCompute, parseMove, readOperand,
} from './statements.mjs';

/** @typedef {import('./lexer.mjs').CobolToken} CobolToken */
/** @typedef {import('./statements.mjs').Operand} Operand */
/** @typedef {import('./statements.mjs').Statement} Statement */
/** @typedef {import('./symbols.mjs').DataItem} DataItem */

/**
 * @typedef {object} CobolContext
 * @property {import('./lexer.mjs').CobolLex} lex
 * @property {CobolToken[]} tokens
 * @property {import('./structure.mjs').DivisionRange[]} ranges
 * @property {{ blocks: import('./structure.mjs').ExecBlock[], inExec: Uint8Array }} exec
 * @property {import('./symbols.mjs').SymbolTable} symbols
 * @property {Statement[]} statements
 * @property {import('../finding.mjs').FindingSink} sink
 */

const SYSTEM_CALLS = new Set(['SYSTEM', 'C$SYSTEM', 'CBL_EXEC_RUN_UNIT']);
const CALL_MODIFIERS = new Set(['STATIC', 'STDCALL']);
const USING_NOISE = new Set(['BY', 'REFERENCE', 'CONTENT', 'VALUE']);
const DISPLAY_STOPS = new Set([
  'UPON', 'WITH', 'NO', 'AT', 'LINE', 'COLUMN', 'COL', 'POSITION', 'ON', 'NOT', 'FOREGROUND-COLOR',
  'BACKGROUND-COLOR', 'HIGHLIGHT', 'LOWLIGHT', 'BLANK', 'ERASE', 'BELL', 'BEEP', 'REVERSE-VIDEO',
  'UNDERLINE', 'BLINK', 'SIZE', 'CONVERSION', 'MODE', 'SCROLL', 'TIME-OUT', 'TIMEOUT',
]);
const LENGTH_FUNCTIONS = new Set(['LENGTH', 'BYTE-LENGTH', 'LENGTH-AN', 'STORED-CHAR-LENGTH']);
const ARITHMETIC_VERBS = new Set(['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'COMPUTE']);

/**
 * Run every PROCEDURE DIVISION rule.
 * @param {CobolContext} ctx
 */
export function checkProcedure(ctx) {
  for (const statement of ctx.statements) {
    switch (statement.verb) {
      case 'CALL': checkCall(ctx, statement); break;
      case 'DISPLAY': checkDisplay(ctx, statement); break;
      case 'MOVE': checkMove(ctx, statement); break;
      case 'ALTER':
        ctx.sink.addAt('ALZ-COB-015', ctx.tokens[statement.start],
          'ALTER rewrites the target of a GO TO at run time: the jump a reviewer reads is not the jump that executes.');
        break;
      default:
        if (ARITHMETIC_VERBS.has(statement.verb)) checkArithmetic(ctx, statement);
    }
  }
  checkDynamicSql(ctx);
}

/**
 * @param {Operand} operand
 * @returns {string}
 */
function nameOf(operand) {
  return escapeInvisible(operand.token.value);
}

/**
 * @param {DataItem} item
 * @returns {string}
 */
function describeItem(item) {
  if (item.picture) return `PIC ${item.picture}`;
  return item.nativeWord ?? item.usage.toUpperCase();
}

// ---------------------------------------------------------------- CALL ---

/**
 * @param {CobolContext} ctx
 * @param {Statement} statement
 */
function checkCall(ctx, statement) {
  const { tokens } = ctx;
  let k = statement.start + 1;
  while (k < statement.end && tokens[k].type === 'word' && CALL_MODIFIERS.has(tokens[k].upper)) k++;
  if (k >= statement.end) return;
  const target = tokens[k];
  if (target.type === 'string') {
    const program = target.value.trim().toUpperCase();
    if (SYSTEM_CALLS.has(program)) reportCommand(ctx, statement, target, program);
    return;
  }
  if (target.type !== 'word' || FIGURATIVES.has(target.upper)) return;
  const operand = readOperand(tokens, k, statement.end);
  const item = ctx.symbols.resolve({ name: target.upper, qualifiers: operand.qualifiers });
  const held = item?.value?.kind === 'string' ? item.value.text.trim() : '';
  const note = held ? ` (initially "${escapeInvisible(held)}", but any MOVE or storage overlay can change it)` : '';
  ctx.sink.addAt('ALZ-COB-001', target,
    `CALL target ${nameOf(operand)} is a data item${note}: the program that runs is chosen at run time. `
    + 'Call a literal program name, selected through an allowlist.');
  if (held && SYSTEM_CALLS.has(held.toUpperCase())) reportCommand(ctx, statement, target, held.toUpperCase());
}

/**
 * @param {CobolContext} ctx
 * @param {Statement} statement
 * @param {CobolToken} at
 * @param {string} program
 */
function reportCommand(ctx, statement, at, program) {
  const argument = firstUsingArgument(ctx.tokens, statement);
  const literal = !argument || argument.kind === 'string' || argument.kind === 'figurative' || argument.kind === 'number';
  if (literal) {
    ctx.sink.addAt('ALZ-COB-002', at,
      `CALL "${program}" runs a fixed command through the operating-system shell; replace it with a library routine.`,
      'medium');
    return;
  }
  const what = argument.kind === 'identifier' ? `the command held in ${nameOf(argument)}` : 'a command built at run time';
  ctx.sink.addAt('ALZ-COB-002', at,
    `CALL "${program}" passes ${what} to the operating-system shell: any record or input data placed in it can inject shell metacharacters.`,
    'critical');
}

/**
 * @param {CobolToken[]} tokens
 * @param {Statement} statement
 * @returns {Operand|null}
 */
function firstUsingArgument(tokens, statement) {
  let k = statement.start + 1;
  while (k < statement.end && !isWord(tokens[k], 'USING')) k++;
  k += 1;
  while (k < statement.end && tokens[k].type === 'word' && USING_NOISE.has(tokens[k].upper)) k++;
  return k < statement.end ? readOperand(tokens, k, statement.end) : null;
}

// ------------------------------------------------------------ EXEC SQL ---

/** @param {CobolContext} ctx */
function checkDynamicSql(ctx) {
  const { tokens } = ctx;
  for (const block of ctx.exec.blocks) {
    if (block.kind !== 'SQL') continue;
    for (let k = block.start + 2; k < block.end; k++) {
      const token = tokens[k];
      if (token.type !== 'word') continue;
      if (token.upper === 'PREPARE') {
        const limit = Math.min(block.end, k + 24);
        let j = k + 1;
        while (j < limit && !isWord(tokens[j], 'FROM')) j++;
        const host = hostVariableAt(tokens, j + 1, block.end);
        if (j < limit && host) {
          ctx.sink.addAt('ALZ-COB-003', token,
            `PREPARE compiles SQL text taken from host variable :${escapeInvisible(host.value)}: if it is built from input, this is SQL injection. Use static SQL or parameter markers (?).`);
        }
      } else if (token.upper === 'EXECUTE' && isWord(tokens[k + 1], 'IMMEDIATE')) {
        const host = hostVariableAt(tokens, k + 2, block.end);
        if (host) {
          ctx.sink.addAt('ALZ-COB-003', token,
            `EXECUTE IMMEDIATE runs SQL text taken from host variable :${escapeInvisible(host.value)}: if it is built from input, this is SQL injection. Use static SQL or parameter markers (?).`);
        }
      }
    }
  }
}

/**
 * ":name" at index k.
 * @param {CobolToken[]} tokens
 * @param {number} k
 * @param {number} end
 * @returns {CobolToken|null}
 */
function hostVariableAt(tokens, k, end) {
  if (k + 1 > end || !isPunct(tokens[k], ':')) return null;
  const name = tokens[k + 1];
  return name && name.type === 'word' ? name : null;
}

// ------------------------------------------------------------- DISPLAY ---

/**
 * @param {CobolContext} ctx
 * @param {Statement} statement
 */
function checkDisplay(ctx, statement) {
  const { tokens } = ctx;
  let k = statement.start + 1;
  while (k < statement.end) {
    const token = tokens[k];
    if (token.type === 'word' && DISPLAY_STOPS.has(token.upper)) break;
    const operand = readOperand(tokens, k, statement.end);
    // A reference-modified operand (WS-PAN(1:6)) is the usual masking idiom.
    if (operand.kind === 'identifier' && !operand.refMod) reportSensitive(ctx, operand.token);
    else if (operand.kind === 'function' && !LENGTH_FUNCTIONS.has(operand.name ?? '')) {
      for (let j = operand.argsStart ?? 0; j < (operand.argsEnd ?? 0); j++) {
        const arg = tokens[j];
        const prev = tokens[j - 1];
        if (arg.type !== 'word' || FIGURATIVES.has(arg.upper) || isWord(prev, 'OF') || isWord(prev, 'IN')
          || isWord(prev, 'FUNCTION') || arg.upper === 'FUNCTION') continue;
        reportSensitive(ctx, arg);
      }
    }
    k = operand.next;
  }
}

/**
 * @param {CobolContext} ctx
 * @param {CobolToken} token
 */
function reportSensitive(ctx, token) {
  if (!isCobolSensitiveName(token.upper)) return;
  ctx.sink.addAt('ALZ-COB-005', token,
    `DISPLAY writes ${escapeInvisible(token.value)} to SYSOUT and the job log, where operators and log archives keep it: `
    + 'card numbers, CVVs, PINs, passwords, IBANs and tokens must never be displayed. Display a masked value instead.');
}

// ---------------------------------------------------------------- MOVE ---

/**
 * @param {CobolContext} ctx
 * @param {Statement} statement
 */
function checkMove(ctx, statement) {
  const move = parseMove(ctx.tokens, statement);
  if (!move) return;
  const { source } = move;
  const sourceItem = source.kind === 'identifier' && !source.refMod
    ? ctx.symbols.resolve({ name: /** @type {string} */ (source.name), qualifiers: source.qualifiers })
    : null;
  for (const receiver of move.receivers) {
    if (receiver.refMod) continue;
    const target = ctx.symbols.resolve({ name: /** @type {string} */ (receiver.name), qualifiers: receiver.qualifiers });
    if (!target) continue;
    if (sourceItem) checkItemMove(ctx, source, sourceItem, receiver, target);
    else if (source.kind === 'number') checkNumericLiteralMove(ctx, source.token, receiver, target);
    else if (source.kind === 'string') checkStringLiteralMove(ctx, source.token, receiver, target);
  }
}

/** @param {DataItem} item */
function isFixedNumeric(item) {
  return (item.category === 'numeric' || item.category === 'numeric-edited')
    && !item.float && item.intDigits !== null && item.decDigits !== null;
}

/** @param {DataItem} item */
function isText(item) {
  return (item.category === 'alphanumeric' || item.category === 'alphabetic') && item.length !== null;
}

/**
 * @param {CobolContext} ctx
 * @param {Operand} source
 * @param {DataItem} from
 * @param {Operand} receiver
 * @param {DataItem} to
 */
function checkItemMove(ctx, source, from, receiver, to) {
  if (isFixedNumeric(from) && from.category === 'numeric' && isFixedNumeric(to)) {
    if (from.signed && !to.signed && to.category === 'numeric') {
      ctx.sink.addAt('ALZ-COB-006', receiver.token,
        `Signed ${nameOf(source)} (${describeItem(from)}) is moved to unsigned ${nameOf(receiver)} (${describeItem(to)}): `
        + 'a negative value silently loses its sign (-500.00 becomes 500.00).');
    }
    const lost = digitLoss(/** @type {number} */ (from.intDigits), /** @type {number} */ (from.decDigits), to);
    if (lost) {
      ctx.sink.addAt('ALZ-COB-007', receiver.token,
        `MOVE ${nameOf(source)} (${describeItem(from)}) to ${nameOf(receiver)} (${describeItem(to)}) silently drops ${lost}.`);
    }
    return;
  }
  if (isText(from) && isText(to) && /** @type {number} */ (from.length) > /** @type {number} */ (to.length)) {
    ctx.sink.addAt('ALZ-COB-008', receiver.token,
      `MOVE ${nameOf(source)} (${from.length} characters) to ${nameOf(receiver)} (${to.length} characters) cuts off the last ${/** @type {number} */ (from.length) - /** @type {number} */ (to.length)} characters.`);
  }
}

/**
 * @param {number} intDigits
 * @param {number} decDigits
 * @param {DataItem} to
 * @returns {string|null}
 */
function digitLoss(intDigits, decDigits, to) {
  const parts = [];
  if (intDigits > /** @type {number} */ (to.intDigits)) {
    parts.push(`high-order digits (${intDigits} integer digits into ${to.intDigits})`);
  }
  if (decDigits > /** @type {number} */ (to.decDigits)) {
    parts.push(`decimal digits (${decDigits} decimals into ${to.decDigits})`);
  }
  return parts.length > 0 ? parts.join(' and ') : null;
}

/**
 * @param {CobolContext} ctx
 * @param {CobolToken} literal
 * @param {Operand} receiver
 * @param {DataItem} to
 */
function checkNumericLiteralMove(ctx, literal, receiver, to) {
  if (!isFixedNumeric(to)) return;
  const parsed = parseNumericLiteral(literal.value);
  if (!parsed) return;
  if (parsed.negative && !parsed.zero && !to.signed && to.category === 'numeric') {
    ctx.sink.addAt('ALZ-COB-006', receiver.token,
      `Negative literal ${literal.value} is moved to unsigned ${nameOf(receiver)} (${describeItem(to)}): the sign is dropped.`);
  }
  const intRoom = /** @type {number} */ (to.intDigits);
  const decRoom = /** @type {number} */ (to.decDigits);
  if (parsed.intDigits.length > intRoom || parsed.decDigits.length > decRoom) {
    ctx.sink.addAt('ALZ-COB-007', receiver.token,
      `Literal ${literal.value} does not fit ${nameOf(receiver)} (${describeItem(to)}) and is silently truncated to `
      + `${truncatedLiteral(parsed, intRoom, decRoom, to.signed)}.`);
  }
}

/**
 * The value a numeric MOVE actually stores (digits beyond the receiver dropped).
 * @param {{ negative: boolean, intDigits: string, decDigits: string }} parsed
 * @param {number} intRoom
 * @param {number} decRoom
 * @param {boolean} signed
 * @returns {string}
 */
function truncatedLiteral(parsed, intRoom, decRoom, signed) {
  let integer = intRoom > 0 ? parsed.intDigits.slice(-intRoom) : '';
  let start = 0;
  while (start < integer.length - 1 && integer[start] === '0') start++;
  integer = integer.slice(start) || '0';
  const decimals = decRoom > 0 ? `.${parsed.decDigits.slice(0, decRoom).padEnd(decRoom, '0')}` : '';
  return `${parsed.negative && signed ? '-' : ''}${integer}${decimals}`;
}

/**
 * @param {CobolContext} ctx
 * @param {CobolToken} literal
 * @param {Operand} receiver
 * @param {DataItem} to
 */
function checkStringLiteralMove(ctx, literal, receiver, to) {
  if (literal.prefix || !isText(to)) return;
  if (literal.value.length > /** @type {number} */ (to.length)) {
    ctx.sink.addAt('ALZ-COB-008', receiver.token,
      `The ${literal.value.length}-character literal does not fit ${nameOf(receiver)} (${to.length} characters) and is cut off.`);
  }
}

// ---------------------------------------------------------- arithmetic ---

/**
 * @typedef {object} ArithmeticShape
 * @property {Operand[]} receivers
 * @property {Operand[]} sources
 * @property {boolean} divides
 * @property {boolean} unsafeDivision  a divisor that is not a non-zero literal
 * @property {string} divisor          text of the (first unsafe) divisor
 * @property {boolean} multiplies
 * @property {boolean} [exponent]      '**' (decimals of the result are unbounded)
 * @property {import('./bounds.mjs').Bound|null} result  bound of the stored value, when the
 *   receiver is not itself an operand (GIVING, COMPUTE); null when unknown
 */

/**
 * @param {CobolContext} ctx
 * @param {Statement} statement
 */
function checkArithmetic(ctx, statement) {
  const shape = statement.verb === 'COMPUTE'
    ? computeShape(ctx, statement)
    : verbShape(ctx, statement);
  if (!shape) return;
  const verbToken = ctx.tokens[statement.start];
  const sizeError = hasSizeError(ctx.tokens, statement);
  const monetary = shape.receivers.filter((r) => isMoneyReceiver(ctx, r));
  if (!sizeError && shape.unsafeDivision) {
    const into = shape.receivers.length > 0 ? ` into ${nameOf(shape.receivers[0])}` : '';
    ctx.sink.addAt('ALZ-COB-010', verbToken,
      `${statement.verb}${into} divides by ${escapeInvisible(shape.divisor)} without ON SIZE ERROR: a zero divisor abends the job or leaves the receiver unchanged and processing continues.`);
  } else if (!sizeError && statement.verb !== 'DIVIDE' && monetary.length > 0) {
    const receiver = monetary.find((r) => !fitsIntegerDigits(shape.result, resolveOperand(ctx, r)?.intDigits ?? null));
    if (receiver) {
      const item = resolveOperand(ctx, receiver);
      const capacity = item && item.picture ? ` (PIC ${item.picture})` : '';
      ctx.sink.addAt('ALZ-COB-009', verbToken,
        `${statement.verb} into ${nameOf(receiver)}${capacity} has no ON SIZE ERROR: a result that does not fit loses its high-order digits silently.`);
    }
  }
  if (statement.verb === 'ADD' || statement.verb === 'SUBTRACT') return;
  if (!shape.divides && !shape.multiplies) return;
  for (const receiver of monetary) {
    if (receiver.rounded) continue;
    const item = ctx.symbols.resolve({ name: /** @type {string} */ (receiver.name), qualifiers: receiver.qualifiers });
    if (!item || item.float || item.decDigits === null || item.decDigits === 0) continue;
    if (!shape.divides && !shape.exponent && !productMayTruncate(ctx, shape.sources, item.decDigits)) continue;
    const what = shape.divides ? 'quotient' : shape.exponent ? 'power' : 'product';
    ctx.sink.addAt('ALZ-COB-013', receiver.token,
      `${nameOf(receiver)} (${describeItem(item)}) receives a ${what} without ROUNDED: `
      + 'fractions of a cent are truncated instead of rounded, a systematic loss ("salami slicing").');
  }
}

/**
 * @param {CobolContext} ctx
 * @param {Operand} operand
 * @returns {DataItem|null}
 */
function resolveOperand(ctx, operand) {
  if (operand.kind !== 'identifier' || operand.refMod) return null;
  return ctx.symbols.resolve({ name: /** @type {string} */ (operand.name), qualifiers: operand.qualifiers });
}

/**
 * Bound of a list of operands combined with + (or * when `multiply`).
 * @param {CobolContext} ctx
 * @param {Operand[]} operands
 * @param {boolean} multiply
 * @returns {import('./bounds.mjs').Bound|null}
 */
function combinedBound(ctx, operands, multiply) {
  if (operands.length === 0) return null;
  let bound = operandBound(ctx, operands[0]);
  for (const operand of operands.slice(1)) {
    const next = operandBound(ctx, operand);
    bound = multiply ? multiplyBounds(bound, next) : addBounds(bound, next);
  }
  return bound;
}

/**
 * @param {CobolContext} ctx
 * @param {Operand} operand
 * @returns {import('./bounds.mjs').Bound|null}
 */
function operandBound(ctx, operand) {
  if (operand.kind === 'number') return literalBound(operand.token.value);
  return itemBound(resolveOperand(ctx, operand));
}

/**
 * A receiver that holds money: a strong money word, or a weak one (TOTAL,
 * SUM, RATE, LIMIT) on a field with decimal places.
 * @param {CobolContext} ctx
 * @param {Operand} receiver
 * @returns {boolean}
 */
function isMoneyReceiver(ctx, receiver) {
  const strength = cobolMoneyStrength(/** @type {string} */ (receiver.name));
  if (strength === null) return false;
  const item = ctx.symbols.resolve({ name: /** @type {string} */ (receiver.name), qualifiers: receiver.qualifiers });
  if (item?.float) return false; // floating point is ALZ-COB-011's concern
  return strength === 'strong' || (item !== null && (item.decDigits ?? 0) > 0);
}

/**
 * Upper bound on the decimals of a product is the sum of the operands'
 * decimals; only when it fits the receiver can truncation be ruled out.
 * @param {CobolContext} ctx
 * @param {Operand[]} sources
 * @param {number} receiverDecimals
 * @returns {boolean}
 */
function productMayTruncate(ctx, sources, receiverDecimals) {
  let decimals = 0;
  for (const operand of sources) {
    if (operand.kind === 'number') {
      const parsed = parseNumericLiteral(operand.token.value);
      decimals += parsed ? parsed.decDigits.length : 0;
    } else if (operand.kind === 'identifier') {
      const item = ctx.symbols.resolve({ name: /** @type {string} */ (operand.name), qualifiers: operand.qualifiers });
      if (!item || item.decDigits === null || item.float) return true;
      decimals += item.decDigits;
    } else if (operand.kind !== 'figurative') {
      return true;
    }
  }
  return decimals > receiverDecimals;
}

/**
 * @param {CobolContext} ctx
 * @param {Statement} statement
 * @returns {ArithmeticShape|null}
 */
function verbShape(ctx, statement) {
  const verb = statement.verb;
  const segments = arithmeticSegments(ctx.tokens, statement.start + 1, statement.end);
  const find = (keyword) => segments.find((s) => s.keyword === keyword);
  const first = segments[0].operands;
  const giving = find('GIVING');
  const remainder = find('REMAINDER');
  /** @type {Operand[]} */
  let receivers = [];
  /** @type {Operand[]} */
  let sources = [...first];
  let divisorOperand = null;
  if (verb === 'ADD') receivers = giving ? giving.operands : find('TO')?.operands ?? [];
  else if (verb === 'SUBTRACT') receivers = giving ? giving.operands : find('FROM')?.operands ?? [];
  else if (verb === 'MULTIPLY') {
    const by = find('BY')?.operands ?? [];
    receivers = giving ? giving.operands : by;
    sources = [...first, ...by.slice(0, 1)];
  } else if (verb === 'DIVIDE') {
    const into = find('INTO');
    const by = find('BY');
    divisorOperand = into ? first[0] : by?.operands[0];
    receivers = giving ? giving.operands : into?.operands ?? [];
    if (remainder) receivers = [...receivers, ...remainder.operands];
  }
  receivers = receivers.filter((r) => r.kind === 'identifier');
  if (receivers.length === 0) return null;
  const unsafeDivision = verb === 'DIVIDE' && !isNonZeroLiteral(divisorOperand);
  /** @type {import('./bounds.mjs').Bound|null} */
  let result = null;
  if (giving && verb !== 'DIVIDE') {
    const operands = [...first, ...(find(verb === 'ADD' ? 'TO' : verb === 'SUBTRACT' ? 'FROM' : 'BY')?.operands ?? [])];
    result = combinedBound(ctx, operands, verb === 'MULTIPLY');
  }
  return {
    receivers,
    sources,
    divides: verb === 'DIVIDE',
    unsafeDivision,
    divisor: divisorOperand ? divisorOperand.token.value : 'the divisor',
    multiplies: verb === 'MULTIPLY',
    result,
  };
}

/**
 * @param {Operand|null|undefined} operand
 * @returns {boolean}
 */
function isNonZeroLiteral(operand) {
  if (!operand || operand.kind !== 'number') return false;
  const parsed = parseNumericLiteral(operand.token.value);
  return parsed !== null && !parsed.zero;
}

/**
 * @param {CobolContext} ctx
 * @param {Statement} statement
 * @returns {ArithmeticShape|null}
 */
function computeShape(ctx, statement) {
  const { tokens } = ctx;
  const parsed = parseCompute(tokens, statement);
  if (!parsed || parsed.receivers.length === 0) return null;
  let divides = false;
  let unsafeDivision = false;
  let divisor = '';
  let multiplies = false;
  let exponent = false;
  /** @type {Operand[]} */
  const sources = [];
  let k = parsed.exprStart;
  while (k < parsed.exprEnd) {
    const token = tokens[k];
    if (isPunct(token, '/')) {
      divides = true;
      const next = tokens[k + 1];
      const operand = next && k + 1 < parsed.exprEnd ? readOperand(tokens, k + 1, parsed.exprEnd) : null;
      if (!isNonZeroLiteral(operand) || isPunct(tokens[operand ? operand.next : k + 1], '**')) {
        if (!unsafeDivision) divisor = next ? (isPunct(next, '(') ? 'a parenthesised expression' : next.value) : 'the divisor';
        unsafeDivision = true;
      }
      k += 1;
    } else if (isPunct(token, '*') || isPunct(token, '**')) {
      multiplies = true;
      exponent ||= isPunct(token, '**');
      k += 1;
    } else if (token.type === 'word' || token.type === 'number' || token.type === 'string') {
      const operand = readOperand(tokens, k, parsed.exprEnd);
      sources.push(operand);
      k = operand.next;
    } else {
      k += 1;
    }
  }
  const result = expressionBound((operand) => resolveOperand(ctx, operand), tokens, parsed.exprStart, parsed.exprEnd);
  return { receivers: parsed.receivers, sources, divides, unsafeDivision, divisor, multiplies, exponent, result };
}
