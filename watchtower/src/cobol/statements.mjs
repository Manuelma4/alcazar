/**
 * PROCEDURE DIVISION statement segmentation and operand parsing.
 *
 * A statement spans from its verb to the next statement verb, scope
 * terminator (END-xxx), ELSE / WHEN, EXEC block or period. Spans never
 * overlap, so segmentation is linear in the number of tokens.
 */
import { FIGURATIVES } from './symbols.mjs';
import { VERBS, rangesOf } from './structure.mjs';

/** @typedef {import('./lexer.mjs').CobolToken} CobolToken */

/**
 * @typedef {object} Statement
 * @property {string} verb
 * @property {number} start index of the verb token
 * @property {number} end   exclusive
 */

/**
 * @typedef {object} Operand
 * @property {'identifier'|'string'|'number'|'figurative'|'function'|'special'|'other'} kind
 * @property {CobolToken} token     first token
 * @property {number} next          index after the operand
 * @property {string} [name]        identifier / function name (upper case)
 * @property {string[]} [qualifiers]
 * @property {boolean} [refMod]
 * @property {boolean} [subscripted]
 * @property {number} [argsStart]   function arguments (inside the parentheses)
 * @property {number} [argsEnd]
 * @property {boolean} [rounded]
 */

/**
 * @param {CobolToken} token
 * @returns {boolean}
 */
export function isStatementBoundary(token) {
  if (token.type === 'period') return true;
  if (token.type !== 'word') return false;
  const word = token.upper;
  return VERBS.has(word) || word.startsWith('END-') || word === 'ELSE' || word === 'WHEN';
}

/**
 * Split the PROCEDURE DIVISION into statements.
 * @param {CobolToken[]} tokens
 * @param {import('./structure.mjs').DivisionRange[]} ranges
 * @param {Uint8Array} inExec
 * @returns {Statement[]}
 */
export function procedureStatements(tokens, ranges, inExec) {
  /** @type {Statement[]} */
  const statements = [];
  for (const range of rangesOf(ranges, 'PROCEDURE')) {
    for (let i = range.start; i < range.end; i++) {
      const token = tokens[i];
      if (inExec[i] || token.type !== 'word' || !VERBS.has(token.upper)) continue;
      let j = i + 1;
      while (j < range.end && !inExec[j] && !isStatementBoundary(tokens[j])) j++;
      statements.push({ verb: token.upper, start: i, end: j });
    }
  }
  return statements;
}

/**
 * Index of the parenthesis closing the one at `open` (bounded by `end`).
 * @param {CobolToken[]} tokens
 * @param {number} open
 * @param {number} end
 * @returns {number}
 */
export function matchParen(tokens, open, end) {
  let depth = 0;
  for (let k = open; k < end; k++) {
    const token = tokens[k];
    if (token.type !== 'punct') continue;
    if (token.value === '(') depth += 1;
    else if (token.value === ')') {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return end - 1;
}

/**
 * @param {CobolToken[]} tokens
 * @param {number} open
 * @param {number} close
 * @returns {boolean}
 */
function hasTopLevelColon(tokens, open, close) {
  let depth = 0;
  for (let k = open + 1; k < close; k++) {
    const token = tokens[k];
    if (token.type !== 'punct') continue;
    if (token.value === '(') depth += 1;
    else if (token.value === ')') depth -= 1;
    else if (token.value === ':' && depth === 0) return true;
  }
  return false;
}

/**
 * @param {CobolToken|undefined} token
 * @param {string} value
 */
export function isPunct(token, value) {
  return token !== undefined && token.type === 'punct' && token.value === value;
}

/**
 * @param {CobolToken|undefined} token
 * @param {string} word
 */
export function isWord(token, word) {
  return token !== undefined && token.type === 'word' && token.upper === word;
}

/**
 * Read one operand: literal, figurative constant, FUNCTION call, LENGTH OF,
 * or identifier [OF|IN qualifier]... [(subscripts)] [(ref-mod)].
 * @param {CobolToken[]} tokens
 * @param {number} i
 * @param {number} end
 * @returns {Operand}
 */
export function readOperand(tokens, i, end) {
  const token = tokens[i];
  if (token.type === 'string') return { kind: 'string', token, next: i + 1 };
  if (token.type === 'number') return { kind: 'number', token, next: i + 1 };
  if (token.type !== 'word') return { kind: 'other', token, next: i + 1 };
  const word = token.upper;
  if (FIGURATIVES.has(word)) return { kind: 'figurative', token, next: i + 1 };
  if (word === 'ALL') return { kind: 'figurative', token, next: Math.min(i + 2, end) };
  if (word === 'FUNCTION') return readFunction(tokens, i, end);
  if ((word === 'LENGTH' || word === 'ADDRESS') && isWord(tokens[i + 1], 'OF')) {
    const inner = i + 2 < end ? readOperand(tokens, i + 2, end) : null;
    return { kind: 'special', token, name: word, next: inner ? inner.next : Math.min(i + 2, end) };
  }
  let k = i + 1;
  /** @type {string[]} */
  const qualifiers = [];
  while (k + 1 < end && (isWord(tokens[k], 'OF') || isWord(tokens[k], 'IN')) && tokens[k + 1].type === 'word') {
    qualifiers.push(tokens[k + 1].upper);
    k += 2;
  }
  let refMod = false;
  let subscripted = false;
  while (k < end && isPunct(tokens[k], '(')) {
    const close = matchParen(tokens, k, end);
    if (hasTopLevelColon(tokens, k, close)) refMod = true;
    else subscripted = true;
    k = close + 1;
  }
  return { kind: 'identifier', token, name: word, qualifiers, refMod, subscripted, next: k };
}

/**
 * @param {CobolToken[]} tokens
 * @param {number} i index of FUNCTION
 * @param {number} end
 * @returns {Operand}
 */
function readFunction(tokens, i, end) {
  const nameToken = tokens[i + 1];
  let k = Math.min(i + 2, end);
  let argsStart = k;
  let argsEnd = k;
  if (k < end && isPunct(tokens[k], '(')) {
    const close = matchParen(tokens, k, end);
    argsStart = k + 1;
    argsEnd = close;
    k = close + 1;
  }
  return { kind: 'function', token: tokens[i], name: nameToken ? nameToken.upper : '', argsStart, argsEnd, next: k };
}

const SEGMENT_KEYWORDS = new Set(['TO', 'FROM', 'BY', 'INTO', 'GIVING', 'REMAINDER']);
const PHRASE_STOPS = new Set(['ON', 'NOT', 'SIZE', 'ERROR', 'WITH', 'OVERFLOW', 'EXCEPTION']);

/**
 * @typedef {object} Segment
 * @property {string|null} keyword  keyword that opened the segment (null for the first)
 * @property {Operand[]} operands
 */

/**
 * Split an arithmetic statement into keyword segments
 * (ADD a b TO c GIVING d -> [a b], TO [c], GIVING [d]).
 * @param {CobolToken[]} tokens
 * @param {number} start first token after the verb
 * @param {number} end
 * @returns {Segment[]}
 */
export function arithmeticSegments(tokens, start, end) {
  /** @type {Segment[]} */
  const segments = [{ keyword: null, operands: [] }];
  let k = start;
  while (k < end) {
    const token = tokens[k];
    if (token.type === 'word') {
      const word = token.upper;
      if (SEGMENT_KEYWORDS.has(word)) {
        segments.push({ keyword: word, operands: [] });
        k += 1;
        continue;
      }
      if (word === 'ROUNDED') {
        const operands = segments[segments.length - 1].operands;
        if (operands.length > 0) operands[operands.length - 1].rounded = true;
        k = skipRoundedMode(tokens, k + 1, end);
        continue;
      }
      if (word === 'CORRESPONDING' || word === 'CORR') {
        k += 1;
        continue;
      }
      if (PHRASE_STOPS.has(word)) break;
    }
    const operand = readOperand(tokens, k, end);
    segments[segments.length - 1].operands.push(operand);
    k = operand.next;
  }
  return segments;
}

/**
 * Skip "MODE [IS] mode-name" after ROUNDED.
 * @param {CobolToken[]} tokens
 * @param {number} k
 * @param {number} end
 * @returns {number}
 */
function skipRoundedMode(tokens, k, end) {
  if (k < end && isWord(tokens[k], 'MODE')) {
    k += 1;
    if (k < end && isWord(tokens[k], 'IS')) k += 1;
    k += 1;
  }
  return Math.min(k, end);
}

/**
 * Receivers of a COMPUTE (before '=' / EQUAL) and the expression span.
 * @param {CobolToken[]} tokens
 * @param {Statement} statement
 * @returns {{ receivers: Operand[], exprStart: number, exprEnd: number } | null}
 */
export function parseCompute(tokens, statement) {
  /** @type {Operand[]} */
  const receivers = [];
  let k = statement.start + 1;
  while (k < statement.end) {
    const token = tokens[k];
    if (isPunct(token, '=') || isWord(token, 'EQUAL')) break;
    if (isWord(token, 'ROUNDED')) {
      if (receivers.length > 0) receivers[receivers.length - 1].rounded = true;
      k = skipRoundedMode(tokens, k + 1, statement.end);
      continue;
    }
    const operand = readOperand(tokens, k, statement.end);
    if (operand.kind === 'identifier') receivers.push(operand);
    k = operand.next;
  }
  if (k >= statement.end) return null;
  const exprStart = k + 1;
  let exprEnd = exprStart;
  while (exprEnd < statement.end && !(tokens[exprEnd].type === 'word' && PHRASE_STOPS.has(tokens[exprEnd].upper))) {
    exprEnd += 1;
  }
  return { receivers, exprStart, exprEnd };
}

/**
 * True when the statement span contains "SIZE ERROR".
 * @param {CobolToken[]} tokens
 * @param {Statement} statement
 * @returns {boolean}
 */
export function hasSizeError(tokens, statement) {
  for (let k = statement.start + 1; k < statement.end; k++) {
    if (isWord(tokens[k], 'SIZE') && isWord(tokens[k + 1], 'ERROR')) return true;
  }
  return false;
}

const MOVE_STOPS = new Set(['TO']);

/**
 * MOVE source TO receiver... (MOVE CORRESPONDING is not analysed).
 * @param {CobolToken[]} tokens
 * @param {Statement} statement
 * @returns {{ source: Operand, receivers: Operand[] } | null}
 */
export function parseMove(tokens, statement) {
  let k = statement.start + 1;
  if (k >= statement.end) return null;
  if (isWord(tokens[k], 'CORRESPONDING') || isWord(tokens[k], 'CORR')) return null;
  const source = readOperand(tokens, k, statement.end);
  k = source.next;
  if (!isWord(tokens[k], 'TO') || k >= statement.end) return null;
  k += 1;
  /** @type {Operand[]} */
  const receivers = [];
  while (k < statement.end) {
    const token = tokens[k];
    if (token.type !== 'word' || MOVE_STOPS.has(token.upper)) break;
    const operand = readOperand(tokens, k, statement.end);
    if (operand.kind === 'identifier') receivers.push(operand);
    k = operand.next;
  }
  return { source, receivers };
}
