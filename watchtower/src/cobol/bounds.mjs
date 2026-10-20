/**
 * Magnitude bounds of COBOL arithmetic, used to prove that a result always
 * fits its receiver (in which case a missing ON SIZE ERROR is harmless).
 * Bounds are exact scaled BigInts: |value| <= num / 10^scale.
 */
import { isPunct, readOperand } from './statements.mjs';

/** @typedef {import('./lexer.mjs').CobolToken} CobolToken */
/** @typedef {import('./symbols.mjs').DataItem} DataItem */
/** @typedef {import('./statements.mjs').Operand} Operand */

/**
 * @typedef {object} Bound
 * @property {bigint} num
 * @property {number} scale
 */

const MAX_DIGITS = 60;
const MAX_DEPTH = 40;

/**
 * @param {string} text numeric literal
 * @returns {{ negative: boolean, zero: boolean, intDigits: string, decDigits: string } | null}
 */
export function parseNumericLiteral(text) {
  let body = text;
  let negative = false;
  if (body.startsWith('-') || body.startsWith('+')) {
    negative = body[0] === '-';
    body = body.slice(1);
  }
  if (body.includes('E') || body.includes('e')) return null;
  const point = Math.max(body.indexOf('.'), body.indexOf(','));
  let intPart = point === -1 ? body : body.slice(0, point);
  let decPart = point === -1 ? '' : body.slice(point + 1);
  let start = 0;
  while (start < intPart.length && intPart[start] === '0') start++;
  intPart = intPart.slice(start);
  let end = decPart.length;
  while (end > 0 && decPart[end - 1] === '0') end--;
  decPart = decPart.slice(0, end);
  for (const ch of intPart + decPart) if (ch < '0' || ch > '9') return null;
  return { negative, zero: intPart === '' && decPart === '', intDigits: intPart, decDigits: decPart };
}

/**
 * Largest magnitude a numeric item can hold.
 * @param {DataItem|null} item
 * @returns {Bound|null}
 */
export function itemBound(item) {
  if (!item || item.float || item.category !== 'numeric' || item.intDigits === null || item.decDigits === null) return null;
  const digits = item.intDigits + item.decDigits;
  if (digits > MAX_DIGITS) return null;
  return { num: 10n ** BigInt(digits) - 1n, scale: item.decDigits };
}

/**
 * @param {string} text
 * @returns {Bound|null}
 */
export function literalBound(text) {
  const parsed = parseNumericLiteral(text);
  if (!parsed || parsed.intDigits.length + parsed.decDigits.length > MAX_DIGITS) return null;
  return { num: BigInt(`${parsed.intDigits}${parsed.decDigits}` || '0'), scale: parsed.decDigits.length };
}

/**
 * |a| + |b| (also the bound of a - b).
 * @param {Bound|null} a
 * @param {Bound|null} b
 * @returns {Bound|null}
 */
export function addBounds(a, b) {
  if (!a || !b) return null;
  const scale = Math.max(a.scale, b.scale);
  return {
    num: a.num * 10n ** BigInt(scale - a.scale) + b.num * 10n ** BigInt(scale - b.scale),
    scale,
  };
}

/**
 * |a| * |b|
 * @param {Bound|null} a
 * @param {Bound|null} b
 * @returns {Bound|null}
 */
export function multiplyBounds(a, b) {
  if (!a || !b || a.scale + b.scale > MAX_DIGITS) return null;
  return { num: a.num * b.num, scale: a.scale + b.scale };
}

/**
 * Does every value within the bound keep its integer part in `intDigits`?
 * (Excess decimals are truncated, which is not a size error.)
 * @param {Bound|null} bound
 * @param {number|null} intDigits
 * @returns {boolean}
 */
export function fitsIntegerDigits(bound, intDigits) {
  if (!bound || intDigits === null) return false;
  return bound.num < 10n ** BigInt(intDigits + bound.scale);
}

/**
 * Bound of the arithmetic expression tokens[start, end); null when it
 * cannot be bounded (division, exponentiation, functions, unknown items).
 * @param {(operand: Operand) => DataItem|null} resolve
 * @param {CobolToken[]} tokens
 * @param {number} start
 * @param {number} end
 * @returns {Bound|null}
 */
export function expressionBound(resolve, tokens, start, end) {
  const parser = new BoundParser(resolve, tokens, start, end);
  const bound = parser.expression(0);
  return parser.pos === end ? bound : null;
}

class BoundParser {
  /**
   * @param {(operand: Operand) => DataItem|null} resolve
   * @param {CobolToken[]} tokens
   * @param {number} start
   * @param {number} end
   */
  constructor(resolve, tokens, start, end) {
    this.resolve = resolve;
    this.tokens = tokens;
    this.pos = start;
    this.end = end;
  }

  /**
   * @param {number} depth
   * @returns {Bound|null}
   */
  expression(depth) {
    let bound = this.term(depth);
    while (this.pos < this.end && (isPunct(this.tokens[this.pos], '+') || isPunct(this.tokens[this.pos], '-'))) {
      this.pos += 1;
      bound = addBounds(bound, this.term(depth));
    }
    return bound;
  }

  /**
   * @param {number} depth
   * @returns {Bound|null}
   */
  term(depth) {
    let bound = this.factor(depth);
    while (this.pos < this.end && (isPunct(this.tokens[this.pos], '*') || isPunct(this.tokens[this.pos], '/'))) {
      const divide = isPunct(this.tokens[this.pos], '/');
      this.pos += 1;
      const right = this.factor(depth);
      bound = divide ? null : multiplyBounds(bound, right);
    }
    return bound;
  }

  /**
   * @param {number} depth
   * @returns {Bound|null}
   */
  factor(depth) {
    if (this.pos >= this.end || depth > MAX_DEPTH) {
      this.pos = this.end;
      return null;
    }
    const token = this.tokens[this.pos];
    if (isPunct(token, '+') || isPunct(token, '-')) {
      this.pos += 1;
      return this.factor(depth + 1);
    }
    let bound;
    if (isPunct(token, '(')) {
      this.pos += 1;
      bound = this.expression(depth + 1);
      if (isPunct(this.tokens[this.pos], ')')) this.pos += 1;
      else this.pos = this.end;
    } else {
      const operand = readOperand(this.tokens, this.pos, this.end);
      this.pos = operand.next;
      if (operand.kind === 'number') bound = literalBound(operand.token.value);
      else if (operand.kind === 'figurative' && operand.token.upper.startsWith('ZERO')) bound = { num: 0n, scale: 0 };
      else if (operand.kind === 'identifier' && !operand.refMod) bound = itemBound(this.resolve(operand));
      else bound = null;
    }
    if (this.pos < this.end && isPunct(this.tokens[this.pos], '**')) {
      this.pos += 1;
      this.factor(depth + 1);
      return null;
    }
    return bound;
  }
}
