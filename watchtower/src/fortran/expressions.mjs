/**
 * Expression-level Fortran rules: floating-point equality (ALZ-FOR-005),
 * non-constant-time secret comparison (ALZ-FOR-008) and bound checks that
 * are not short-circuited (ALZ-FOR-014).
 */
import { isFortranSecretName } from '../names.mjs';
import { escapeInvisible } from '../text.mjs';
import { isOp, matchParen, nameOf, splitTopLevel } from './syntax.mjs';

/** @typedef {import('./lexer.mjs').FortranToken} FortranToken */

/**
 * @typedef {object} Scope
 * @property {(name: string) => ({ typeName: string|null, isArray: boolean, isParameter: boolean }|null)} lookup
 * @property {import('../finding.mjs').FindingSink} sink
 */

const EQUALITY = new Set(['==', '/=', '.eq.', '.ne.']);
const RELATIONAL = new Set(['<', '<=', '>', '>=', '.lt.', '.le.', '.gt.', '.ge.']);
const LOGICAL = new Set(['.and.', '.or.', '.eqv.', '.neqv.']);
const OPERAND_SCAN_LIMIT = 64;
const MAX_ATOMS = 200;
/** Intrinsics whose result does not reveal the content of their argument. */
const INQUIRY_FUNCTIONS = new Set([
  'len', 'len_trim', 'size', 'kind', 'allocated', 'present', 'associated', 'storage_size', 'c_sizeof',
  'sizeof', 'ubound', 'lbound', 'shape', 'rank', 'is_contiguous', 'loc', 'c_loc',
]);
const BOUND_FUNCTIONS = new Set(['size', 'len', 'len_trim', 'ubound', 'lbound', 'min', 'max']);

/**
 * @param {FortranToken} token
 * @returns {string}
 */
function opValue(token) {
  return token.type === 'dotop' ? token.lower : token.value;
}

/**
 * @param {FortranToken} token
 * @returns {boolean}
 */
function isComparison(token) {
  return (token.type === 'op' || token.type === 'dotop') && EQUALITY.has(opValue(token));
}

/**
 * @param {FortranToken} token
 * @returns {boolean}
 */
function isLogical(token) {
  return token.type === 'dotop' && LOGICAL.has(token.lower);
}

/**
 * A real literal: digits with a decimal point or an exponent letter
 * (1.0, 0., 1.d0, 1e-3, 0.0_dp). Integer literals with a kind (0_dp) are not.
 * @param {FortranToken|undefined} token
 * @returns {boolean}
 */
export function isRealLiteral(token) {
  if (!token || token.type !== 'number') return false;
  const underscore = token.value.indexOf('_');
  const body = (underscore === -1 ? token.value : token.value.slice(0, underscore)).toLowerCase();
  if (body.includes('.')) return true;
  for (const letter of 'edq') if (body.includes(letter)) return true;
  return false;
}

/**
 * Bounds [start, end) of the operands left and right of the operator at `at`.
 * @param {FortranToken[]} tokens
 * @param {number} at
 * @returns {{ left: [number, number], right: [number, number] }}
 */
function operandSpans(tokens, at) {
  let depth = 0;
  let start = at;
  for (let k = at - 1; k >= 0 && at - k <= OPERAND_SCAN_LIMIT; k--) {
    const token = tokens[k];
    if (isOp(token, ')')) depth += 1;
    else if (isOp(token, '(')) {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && (isOp(token, ',') || isOp(token, '=') || isLogical(token) || (token.type === 'dotop' && token.lower === '.not.'))) break;
    start = k;
  }
  depth = 0;
  let end = at + 1;
  for (let k = at + 1; k < tokens.length && k - at <= OPERAND_SCAN_LIMIT; k++) {
    const token = tokens[k];
    if (isOp(token, '(')) depth += 1;
    else if (isOp(token, ')')) {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && (isOp(token, ',') || isLogical(token))) break;
    end = k + 1;
  }
  return { left: [start, at], right: [at + 1, end] };
}

/**
 * The single literal an operand reduces to ([+|-] literal), if any.
 * @param {FortranToken[]} tokens
 * @param {[number, number]} span
 * @returns {FortranToken|null}
 */
function literalOperand(tokens, [start, end]) {
  let k = start;
  if (k < end && (isOp(tokens[k], '-') || isOp(tokens[k], '+'))) k += 1;
  return end - k === 1 && (tokens[k].type === 'number' || tokens[k].type === 'string') ? tokens[k] : null;
}

/**
 * Secret-looking names in an operand, skipping arguments of inquiry
 * functions such as len() or size().
 * @param {FortranToken[]} tokens
 * @param {[number, number]} span
 * @returns {FortranToken|null}
 */
function secretIn(tokens, [start, end]) {
  for (let k = start; k < end; k++) {
    const token = tokens[k];
    if (token.type !== 'name') continue;
    if (INQUIRY_FUNCTIONS.has(token.lower) && isOp(tokens[k + 1], '(')) {
      const close = matchParen(tokens, k + 1, end);
      if (close === -1) return null;
      k = close;
      continue;
    }
    if (isFortranSecretName(token.lower)) return token;
  }
  return null;
}

/**
 * @param {FortranToken|null} literal
 * @returns {boolean}
 */
function isTrivialOperand(literal) {
  if (!literal) return false;
  return literal.type === 'number' || literal.value.trim() === '';
}

/**
 * Check every equality comparison of one statement (rules 005 and 008).
 * @param {Scope} scope
 * @param {FortranToken[]} tokens
 */
export function checkComparisons(scope, tokens) {
  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (!isComparison(token)) continue;
    const spans = operandSpans(tokens, k);
    const left = literalOperand(tokens, spans.left);
    const right = literalOperand(tokens, spans.right);
    const real = isRealLiteral(left ?? undefined) ? left : isRealLiteral(right ?? undefined) ? right : null;
    if (real) {
      scope.sink.addAt('ALZ-FOR-005', token,
        `Exact ${opValue(token)} comparison with the real literal ${real.value}: rounding error makes this test unreliable. Compare with a tolerance.`);
    }
    if (isTrivialOperand(left) || isTrivialOperand(right)) continue;
    const leftSecret = secretIn(tokens, spans.left);
    const secret = leftSecret ?? secretIn(tokens, spans.right);
    const other = leftSecret ? right : left;
    // compute_mac(k, m) == 'b0344c...' is a known-answer test against a
    // public constant; a variable compared with a literal is still flagged.
    if (secret && other?.type === 'string' && isOp(tokens[tokens.indexOf(secret) + 1], '(')) continue;
    if (secret) {
      scope.sink.addAt('ALZ-FOR-008', token,
        `${escapeInvisible(secret.value)} is compared with ${opValue(token)}, which stops at the first differing character (timing leak) `
        + 'and ignores trailing blanks ("admin" == "admin   " is .true.). Use a constant-time comparison of fixed-length values.');
    }
  }
}

// ------------------------------------------------- short-circuit (014) ---

/**
 * Locate conditions in a statement: IF / ELSE IF / DO WHILE conditions and
 * the right-hand side of logical assignments.
 * @param {FortranToken[]} tokens
 * @param {boolean} assignment
 * @returns {Array<[number, number]>}
 */
export function conditionSpans(tokens, assignment) {
  const first = nameOf(tokens[0]);
  /** @type {Array<[number, number]>} */
  const spans = [];
  const parenthesised = (open) => {
    if (!isOp(tokens[open], '(')) return;
    const close = matchParen(tokens, open);
    if (close !== -1) spans.push([open + 1, close]);
  };
  if (assignment) {
    const eq = tokens.findIndex((t) => isOp(t, '='));
    if (eq !== -1 && tokens.slice(eq + 1).some(isLogical)) spans.push([eq + 1, tokens.length]);
    return spans;
  }
  if (first === 'if') parenthesised(1);
  else if (first === 'elseif') parenthesised(1);
  else if (first === 'else' && nameOf(tokens[1]) === 'if') parenthesised(2);
  else if (first === 'do' || first === 'dowhile') {
    const whileAt = tokens.findIndex((t, i) => i > 0 && nameOf(t) === 'while');
    if (first === 'dowhile') parenthesised(1);
    else if (whileAt !== -1) parenthesised(whileAt + 1);
  }
  return spans;
}

/**
 * Flatten a logical expression into its .and./.or. operands, unwrapping
 * grouping parentheses and .not.
 * @param {FortranToken[]} tokens
 * @param {number} start
 * @param {number} end
 * @param {Array<[number, number]>} out
 * @param {number} depth
 */
function flattenLogical(tokens, start, end, out, depth) {
  if (out.length > MAX_ATOMS) return;
  /** @type {Array<[number, number]>} */
  const parts = [];
  let level = 0;
  let from = start;
  for (let k = start; k < end; k++) {
    const token = tokens[k];
    if (isOp(token, '(')) level += 1;
    else if (isOp(token, ')')) level -= 1;
    else if (level === 0 && isLogical(token)) {
      parts.push([from, k]);
      from = k + 1;
    }
  }
  parts.push([from, end]);
  for (let [s, e] of parts) {
    while (s < e && tokens[s].type === 'dotop' && tokens[s].lower === '.not.') s += 1;
    if (s < e && depth < 20 && isOp(tokens[s], '(') && matchParen(tokens, s, e) === e - 1) {
      flattenLogical(tokens, s + 1, e - 1, out, depth + 1);
    } else if (s < e) {
      out.push([s, e]);
    }
  }
}

/**
 * @typedef {object} Guard
 * @property {Set<string>} vars
 * @property {[number, number]} span
 */

/**
 * "i <= n", "i + 1 < size(a)", "n > 0": a relational test on an integer
 * index variable against a bound.
 * @param {Scope} scope
 * @param {FortranToken[]} tokens
 * @param {[number, number]} span
 * @returns {Guard|null}
 */
function guardOf(scope, tokens, span) {
  const [start, end] = span;
  let relational = -1;
  let level = 0;
  for (let k = start; k < end; k++) {
    const token = tokens[k];
    if (isOp(token, '(')) level += 1;
    else if (isOp(token, ')')) level -= 1;
    else if (level === 0 && (token.type === 'op' || token.type === 'dotop') && RELATIONAL.has(opValue(token))) {
      if (relational !== -1) return null;
      relational = k;
    }
  }
  if (relational === -1) return null;
  const sides = [[start, relational], [relational + 1, end]];
  const vars = new Set();
  for (let side = 0; side < 2; side++) {
    const index = indexVariable(scope, tokens, sides[side]);
    if (index && isBoundLike(tokens, sides[1 - side])) vars.add(index);
  }
  return vars.size > 0 ? { vars, span } : null;
}

/**
 * "i" or "i + 1" / "i - 1" where i is (or implicitly is) an integer.
 * @param {Scope} scope
 * @param {FortranToken[]} tokens
 * @param {number[]} side
 * @returns {string|null}
 */
function indexVariable(scope, tokens, [start, end]) {
  const token = tokens[start];
  if (!token || token.type !== 'name') return null;
  const simple = end - start === 1;
  const offset = end - start === 3 && (isOp(tokens[start + 1], '+') || isOp(tokens[start + 1], '-'))
    && tokens[start + 2].type === 'number';
  if (!simple && !offset) return null;
  const decl = scope.lookup(token.lower);
  if (decl) return decl.typeName === 'integer' && !decl.isArray ? token.lower : null;
  const initial = token.lower.charCodeAt(0);
  return initial >= 105 && initial <= 110 ? token.lower : null; // implicit INTEGER (i-n)
}

/**
 * Names, integer literals, + - * and calls to size/len/ubound/lbound/min/max.
 * @param {FortranToken[]} tokens
 * @param {number[]} side
 * @returns {boolean}
 */
function isBoundLike(tokens, [start, end]) {
  if (end <= start) return false;
  for (let k = start; k < end; k++) {
    const token = tokens[k];
    if (token.type === 'name') {
      if (isOp(tokens[k + 1], '(')) {
        if (!BOUND_FUNCTIONS.has(token.lower)) return false;
        const close = matchParen(tokens, k + 1, end);
        if (close === -1) return false;
        k = close;
      }
    } else if (token.type === 'number') {
      if (isRealLiteral(token)) return false;
    } else if (!(isOp(token, '+') || isOp(token, '-') || isOp(token, '*'))) {
      return false;
    }
  }
  return true;
}

/**
 * @typedef {object} Access
 * @property {FortranToken} token     the array or string name
 * @property {FortranToken} variable  the index variable used
 */

/**
 * Array subscripts a(i), a(i+1), a(j, i) and substrings s(i:i) whose
 * index involves a variable. Only names declared in scope as arrays or
 * character scalars count (an unknown name may be a function call).
 * @param {Scope} scope
 * @param {FortranToken[]} tokens
 * @param {[number, number]} span
 * @returns {Access[]}
 */
function accessesIn(scope, tokens, [start, end]) {
  /** @type {Access[]} */
  const accesses = [];
  for (let k = start; k < end; k++) {
    const token = tokens[k];
    if (token.type !== 'name' || !isOp(tokens[k + 1], '(') || isOp(tokens[k - 1], '%')) continue;
    const close = matchParen(tokens, k + 1, end);
    if (close === -1) continue;
    const decl = scope.lookup(token.lower);
    if (!decl) continue;
    const substring = decl.typeName === 'character' && !decl.isArray;
    if (!decl.isArray && !substring) continue;
    const args = splitTopLevel(tokens, k + 2, close);
    for (const [s, e] of substring ? args.slice(0, 1) : args) {
      const colon = substring ? indexOfColon(tokens, s, e) : -1;
      const limit = substring ? (colon === -1 ? e : colon) : e;
      for (const variable of directNames(tokens, s, limit)) accesses.push({ token, variable });
    }
  }
  return accesses;
}

/**
 * @param {FortranToken[]} tokens
 * @param {number} start
 * @param {number} end
 * @returns {number}
 */
function indexOfColon(tokens, start, end) {
  let level = 0;
  for (let k = start; k < end; k++) {
    if (isOp(tokens[k], '(')) level += 1;
    else if (isOp(tokens[k], ')')) level -= 1;
    else if (level === 0 && isOp(tokens[k], ':')) return k;
  }
  return -1;
}

/**
 * Variable tokens at parenthesis depth 0 of [start, end), excluding calls.
 * @param {FortranToken[]} tokens
 * @param {number} start
 * @param {number} end
 * @returns {FortranToken[]}
 */
function directNames(tokens, start, end) {
  const names = [];
  let level = 0;
  for (let k = start; k < end; k++) {
    const token = tokens[k];
    if (isOp(token, '(')) level += 1;
    else if (isOp(token, ')')) level -= 1;
    else if (level === 0 && token.type === 'name' && !isOp(tokens[k + 1], '(') && !isOp(tokens[k - 1], '%')) names.push(token);
  }
  return names;
}

/**
 * ALZ-FOR-014 for every condition of a statement.
 * @param {Scope} scope
 * @param {FortranToken[]} tokens
 * @param {boolean} assignment
 */
export function checkShortCircuit(scope, tokens, assignment) {
  for (const [start, end] of conditionSpans(tokens, assignment)) {
    /** @type {Array<[number, number]>} */
    const atoms = [];
    flattenLogical(tokens, start, end, atoms, 0);
    if (atoms.length < 2 || atoms.length > MAX_ATOMS) continue;
    const guards = atoms.map((atom) => guardOf(scope, tokens, atom)).filter((g) => g !== null);
    if (guards.length === 0) continue;
    const reported = new Set();
    for (const atom of atoms) {
      for (const access of accessesIn(scope, tokens, atom)) {
        const guard = guards.find((g) => g.span !== atom && g.vars.has(access.variable.lower));
        if (!guard || reported.has(guard)) continue;
        reported.add(guard); // one finding per unprotected guard
        const guardText = tokens.slice(guard.span[0], guard.span[1]).map((t) => t.value).join(' ');
        scope.sink.addAt('ALZ-FOR-014', access.token,
          `${escapeInvisible(access.token.value)}(${escapeInvisible(access.variable.value)}) may be evaluated even when "${escapeInvisible(guardText)}" is false: `
          + 'Fortran does not short-circuit .and./.or., so the access can go out of bounds. Nest the IF statements.');
      }
    }
  }
}
