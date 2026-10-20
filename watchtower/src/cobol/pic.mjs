/**
 * PICTURE string parsing: repetition factors, sign, implied decimal point,
 * scaling positions, alphanumeric / alphabetic / national and edited
 * pictures. Linear, bounded repetition counts, no regular expressions.
 */

/**
 * @typedef {'alphanumeric'|'alphabetic'|'numeric'|'numeric-edited'|'national'} PicCategory
 */

/**
 * @typedef {object} PicInfo
 * @property {PicCategory} category
 * @property {boolean} signed
 * @property {number} intDigits  integer digit positions (numeric / numeric-edited)
 * @property {number} decDigits  decimal digit positions
 * @property {number} length     length in character positions
 */

const SYMBOLS = new Set(['9', 'X', 'A', 'N', 'G', 'U', 'S', 'V', 'P', 'Z', '*', '$', ',', '.', '+', '-', 'B', '0', '/', 'E', '1']);
const EDITING = new Set(['Z', '*', '$', ',', '.', '+', '-', 'B', '0', '/', 'CR', 'DB', 'E']);
const MAX_REPEAT = 10_000_000;

/**
 * @typedef {{ symbol: string, count: number }} PicSymbol
 */

/**
 * Parse a PICTURE character-string. Returns null when it is not valid.
 * @param {string} text
 * @returns {PicInfo|null}
 */
export function parsePicture(text) {
  const symbols = expandSymbols(text.toUpperCase());
  if (!symbols || symbols.length === 0) return null;
  return classify(symbols);
}

/**
 * @param {string} pic upper-cased picture
 * @returns {PicSymbol[]|null}
 */
function expandSymbols(pic) {
  /** @type {PicSymbol[]} */
  const symbols = [];
  let i = 0;
  while (i < pic.length) {
    const pair = pic.slice(i, i + 2);
    if (pair === 'CR' || pair === 'DB') {
      symbols.push({ symbol: pair, count: 1 });
      i += 2;
      continue;
    }
    const symbol = pic[i];
    if (!SYMBOLS.has(symbol)) return null;
    i += 1;
    let count = 1;
    if (pic[i] === '(') {
      let j = i + 1;
      let n = 0;
      while (j < pic.length && pic.charCodeAt(j) >= 48 && pic.charCodeAt(j) <= 57) {
        n = n * 10 + (pic.charCodeAt(j) - 48);
        if (n > MAX_REPEAT) return null;
        j += 1;
      }
      if (pic[j] !== ')' || j === i + 1 || n === 0) return null;
      count = n;
      i = j + 1;
    }
    symbols.push({ symbol, count });
  }
  return symbols;
}

/**
 * @param {PicSymbol[]} symbols
 * @returns {PicInfo|null}
 */
function classify(symbols) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const { symbol, count } of symbols) counts[symbol] = (counts[symbol] ?? 0) + count;
  const has = (s) => (counts[s] ?? 0) > 0;
  const length = symbols.reduce((sum, { symbol, count }) => {
    if (symbol === 'S' || symbol === 'V' || symbol === 'P') return sum;
    return sum + (symbol === 'CR' || symbol === 'DB' ? 2 : count);
  }, 0);

  if (has('N') || has('G') || has('U')) {
    return { category: 'national', signed: false, intDigits: 0, decDigits: 0, length };
  }
  if (has('X') || (has('A') && has('9'))) {
    return { category: 'alphanumeric', signed: false, intDigits: 0, decDigits: 0, length };
  }
  if (has('A')) {
    return { category: 'alphabetic', signed: false, intDigits: 0, decDigits: 0, length };
  }
  const edited = symbols.some(({ symbol }) => EDITING.has(symbol));
  if (!edited && !has('9') && !has('P')) return null;
  const signed = has('S') || has('+') || has('-') || has('CR') || has('DB');
  const { intDigits, decDigits } = edited ? editedDigits(symbols) : numericDigits(symbols);
  return { category: edited ? 'numeric-edited' : 'numeric', signed, intDigits, decDigits, length };
}

/**
 * Digit positions of a plain numeric picture (9, S, V, P).
 * @param {PicSymbol[]} symbols
 * @returns {{ intDigits: number, decDigits: number }}
 */
function numericDigits(symbols) {
  let intDigits = 0;
  let decDigits = 0;
  let afterPoint = false;
  let seenNine = false;
  let leadingP = 0;
  for (const { symbol, count } of symbols) {
    if (symbol === 'V') afterPoint = true;
    else if (symbol === '9') {
      seenNine = true;
      if (afterPoint) decDigits += count;
      else intDigits += count;
    } else if (symbol === 'P') {
      if (seenNine && !afterPoint) intDigits += count; // 99PPP: value scaled by 1000
      else leadingP += count; // PP99 / VPP99: positions right of the point
    }
  }
  if (leadingP > 0) {
    decDigits += leadingP + intDigits;
    intDigits = 0;
  }
  return { intDigits, decDigits };
}

/**
 * Digit positions of a numeric-edited picture. A floating insertion string
 * ($$$, +++, ---) of n symbols represents n - 1 digit positions.
 * @param {PicSymbol[]} symbols
 * @returns {{ intDigits: number, decDigits: number }}
 */
function editedDigits(symbols) {
  let intDigits = 0;
  let decDigits = 0;
  let afterPoint = false;
  /** @type {Set<string>} */
  const floatingSeen = new Set();
  for (const { symbol, count } of symbols) {
    let positions = 0;
    if (symbol === '.' || symbol === 'V') {
      afterPoint = true;
      continue;
    }
    if (symbol === '9' || symbol === 'Z' || symbol === '*') positions = count;
    else if (symbol === '$' || symbol === '+' || symbol === '-') {
      positions = floatingSeen.has(symbol) ? count : count - 1;
      floatingSeen.add(symbol);
    }
    if (afterPoint) decDigits += positions;
    else intDigits += positions;
  }
  return { intDigits, decDigits };
}
