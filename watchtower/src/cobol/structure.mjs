/**
 * Program structure on top of the COBOL token stream: division ranges,
 * EXEC ... END-EXEC blocks and sentence boundaries.
 */

/** @typedef {import('./lexer.mjs').CobolToken} CobolToken */

/**
 * @typedef {object} DivisionRange
 * @property {'IDENTIFICATION'|'ENVIRONMENT'|'DATA'|'PROCEDURE'} name
 * @property {number} start  first token index of the body
 * @property {number} end    exclusive
 */

/**
 * @typedef {object} ExecBlock
 * @property {string} kind   SQL, CICS, DLI ...
 * @property {number} start  index of EXEC
 * @property {number} end    index of END-EXEC (or last token)
 */

const DIVISION_NAMES = new Set(['IDENTIFICATION', 'ENVIRONMENT', 'DATA', 'PROCEDURE']);
const HEADER_SCAN_LIMIT = 500;
const LEVEL_NUMBERS = new Set([66, 77, 88]);
const DATA_STARTERS = new Set(['FD', 'SD', 'RD', 'CD', 'COPY']);

/** COBOL statement verbs (they begin statements in the PROCEDURE DIVISION). */
export const VERBS = new Set([
  'ACCEPT', 'ADD', 'ALLOCATE', 'ALTER', 'CALL', 'CANCEL', 'CLOSE', 'COMMIT', 'COMPUTE', 'CONTINUE',
  'DELETE', 'DISPLAY', 'DIVIDE', 'ENTRY', 'EVALUATE', 'EXEC', 'EXHIBIT', 'EXIT', 'FREE', 'GENERATE',
  'GO', 'GOBACK', 'IF', 'INITIALIZE', 'INITIATE', 'INSPECT', 'INVOKE', 'JSON', 'MERGE', 'MOVE',
  'MULTIPLY', 'OPEN', 'PERFORM', 'READ', 'READY', 'RELEASE', 'RESET', 'RETURN', 'REWRITE', 'ROLLBACK',
  'SEARCH', 'SET', 'SORT', 'START', 'STOP', 'STRING', 'SUBTRACT', 'SUPPRESS', 'TERMINATE',
  'TRANSFORM', 'UNLOCK', 'UNSTRING', 'VALIDATE', 'WRITE', 'XML',
]);

/**
 * True for a level-number token (01-49, 66, 77, 88).
 * @param {CobolToken|undefined} token
 * @returns {boolean}
 */
export function isLevelNumber(token) {
  if (!token || token.type !== 'number' || token.value.length > 2) return false;
  for (let i = 0; i < token.value.length; i++) {
    const code = token.value.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  const level = Number(token.value);
  return (level >= 1 && level <= 49) || LEVEL_NUMBERS.has(level);
}

/**
 * Locate division bodies. Sources without any division header (copybooks,
 * pasted fragments) are split into DATA / ENVIRONMENT / PROCEDURE parts.
 * @param {CobolToken[]} tokens
 * @returns {DivisionRange[]}
 */
export function divisionRanges(tokens) {
  /** @type {{ name: DivisionRange['name'], header: number, start: number }[]} */
  const headers = [];
  for (let i = 0; i + 1 < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'word' || tokens[i + 1].upper !== 'DIVISION' || tokens[i + 1].type !== 'word') continue;
    const name = token.upper === 'ID' ? 'IDENTIFICATION' : token.upper;
    if (!DIVISION_NAMES.has(name)) continue;
    let j = i + 2;
    const limit = Math.min(tokens.length, j + HEADER_SCAN_LIMIT);
    while (j < limit && tokens[j].type !== 'period') j++;
    headers.push({ name: /** @type {DivisionRange['name']} */ (name), header: i, start: Math.min(j + 1, tokens.length) });
  }
  if (headers.length === 0) return fragmentRanges(tokens);
  return headers.map((header, k) => ({
    name: header.name,
    start: header.start,
    end: k + 1 < headers.length ? headers[k + 1].header : tokens.length,
  }));
}

/**
 * Classify the sentences of a header-less fragment.
 * @param {CobolToken[]} tokens
 * @returns {DivisionRange[]}
 */
function fragmentRanges(tokens) {
  /** @type {DivisionRange[]} */
  const ranges = [];
  let start = 0;
  while (start < tokens.length) {
    const end = sentenceEnd(tokens, start, tokens.length);
    const first = tokens[start];
    /** @type {DivisionRange['name']} */
    let name = 'PROCEDURE';
    if (isLevelNumber(first) || DATA_STARTERS.has(first.upper) || first.upper === 'EXEC') name = 'DATA';
    else if (first.upper === 'SELECT') name = 'ENVIRONMENT';
    const last = ranges[ranges.length - 1];
    if (last && last.name === name) last.end = Math.min(end + 1, tokens.length);
    else if (last && last.name === 'PROCEDURE') last.end = Math.min(end + 1, tokens.length);
    else ranges.push({ name, start, end: Math.min(end + 1, tokens.length) });
    start = end + 1;
  }
  return ranges;
}

/**
 * Index of the period ending the sentence that starts at `start` (or `limit`).
 * @param {CobolToken[]} tokens
 * @param {number} start
 * @param {number} limit
 * @returns {number}
 */
export function sentenceEnd(tokens, start, limit) {
  let j = start;
  while (j < limit && tokens[j].type !== 'period') j++;
  return j;
}

/**
 * Find EXEC ... END-EXEC blocks.
 * @param {CobolToken[]} tokens
 * @returns {{ blocks: ExecBlock[], inExec: Uint8Array }}
 */
export function execBlocks(tokens) {
  /** @type {ExecBlock[]} */
  const blocks = [];
  const inExec = new Uint8Array(tokens.length);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.type !== 'word' || token.upper !== 'EXEC' || i + 1 >= tokens.length) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < tokens.length && !(tokens[j].type === 'word' && tokens[j].upper === 'END-EXEC')) j++;
    const end = Math.min(j, tokens.length - 1);
    blocks.push({ kind: tokens[i + 1].upper, start: i, end });
    inExec.fill(1, i, end + 1);
    i = end + 1;
  }
  return { blocks, inExec };
}

/**
 * Ranges of a given division.
 * @param {DivisionRange[]} ranges
 * @param {DivisionRange['name']} name
 * @returns {DivisionRange[]}
 */
export function rangesOf(ranges, name) {
  return ranges.filter((range) => range.name === name);
}
