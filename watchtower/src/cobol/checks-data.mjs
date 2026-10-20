/**
 * Data, file and layout rules: hard-coded credentials (004), floating-point
 * money (011), FILE STATUS (012), LINE SEQUENTIAL record splitting (016) and
 * code hidden beyond column 72 (014).
 */
import { cobolCredentialKind, cobolMoneyStrength } from '../names.mjs';
import { escapeInvisible, isBlankCode } from '../text.mjs';
import { VERBS, rangesOf, sentenceEnd } from './structure.mjs';
import { isWord } from './statements.mjs';

/** @typedef {import('./checks-procedure.mjs').CobolContext} CobolContext */
/** @typedef {import('./lexer.mjs').CobolToken} CobolToken */

/**
 * @param {CobolContext} ctx
 */
export function checkData(ctx) {
  checkCredentials(ctx);
  checkFloatingMoney(ctx);
  checkFileControl(ctx);
  checkOverflowArea(ctx);
}

// --------------------------------------------------------- credentials ---

/** @param {CobolContext} ctx */
function checkCredentials(ctx) {
  for (const item of ctx.symbols.items) {
    const value = item.value;
    if (item.fromCopybook || !value || (value.kind !== 'string' && value.kind !== 'number')) continue;
    const kind = cobolCredentialKind(item.name);
    if (!kind.match) continue;
    if (value.kind === 'string' && value.text.trim() === '') continue;
    if (value.kind === 'number' && (!kind.pin || isAllZeros(value.text))) continue;
    const size = value.kind === 'string' ? `${value.text.length}-character literal` : 'numeric literal';
    ctx.sink.addAt('ALZ-COB-004', value.token,
      `${escapeInvisible(item.token.value)} is initialised with a hard-coded ${size}: the credential is compiled into the load module `
      + 'and visible in source libraries and listings. Obtain it at run time instead.');
  }
}

/** @param {string} text */
function isAllZeros(text) {
  for (const ch of text) if (ch !== '0' && ch !== '.' && ch !== ',' && ch !== '+' && ch !== '-') return false;
  return true;
}

// --------------------------------------------------------- float money ---

/** @param {CobolContext} ctx */
function checkFloatingMoney(ctx) {
  for (const item of ctx.symbols.items) {
    if (item.fromCopybook || !item.float || cobolMoneyStrength(item.name) !== 'strong') continue;
    ctx.sink.addAt('ALZ-COB-011', item.usageToken ?? item.token,
      `${escapeInvisible(item.token.value)} holds money in binary floating point (${item.usage.toUpperCase()}): `
      + 'amounts such as 0.10 cannot be represented exactly, so totals drift and comparisons fail.');
  }
}

// -------------------------------------------------------- file control ---

/**
 * @typedef {object} SelectEntry
 * @property {CobolToken} token       the SELECT keyword
 * @property {string} name
 * @property {CobolToken} nameToken
 * @property {CobolToken|null} status the FILE STATUS data item
 * @property {boolean} lineSequential
 */

/** @param {CobolContext} ctx */
function checkFileControl(ctx) {
  const selects = selectEntries(ctx.tokens, ctx.ranges);
  if (selects.length === 0) return;
  const openedForInput = filesOpenedForInput(ctx);
  for (const entry of selects) {
    if (ctx.symbols.files.get(entry.name) === 'SD') continue;
    const fileName = escapeInvisible(entry.nameToken.value);
    if (!entry.status) {
      ctx.sink.addAt('ALZ-COB-012', entry.token,
        `SELECT ${fileName} has no FILE STATUS clause: OPEN, READ and WRITE errors (missing dataset, short or duplicate records, I/O errors) cannot be detected.`);
      continue;
    }
    if (!entry.lineSequential || !openedForInput.has(entry.name)) continue;
    if (statusChecksLength(ctx, entry.status.upper)) continue;
    ctx.sink.addAt('ALZ-COB-016', entry.token,
      `LINE SEQUENTIAL file ${fileName} is read but ${escapeInvisible(entry.status.value)} is never tested for "04"/"06": `
      + 'GnuCOBOL returns an over-long line as two records (status 06, then the rest with 00), so one crafted line injects an extra record.');
  }
}

/**
 * @param {CobolToken[]} tokens
 * @param {import('./structure.mjs').DivisionRange[]} ranges
 * @returns {SelectEntry[]}
 */
function selectEntries(tokens, ranges) {
  /** @type {SelectEntry[]} */
  const entries = [];
  for (const range of rangesOf(ranges, 'ENVIRONMENT')) {
    for (let i = range.start; i < range.end; i++) {
      if (!isWord(tokens[i], 'SELECT')) continue;
      const end = sentenceEnd(tokens, i, range.end);
      let k = i + 1;
      if (isWord(tokens[k], 'OPTIONAL')) k += 1;
      const nameToken = tokens[k];
      if (nameToken && nameToken.type === 'word' && k < end) {
        entries.push({ token: tokens[i], name: nameToken.upper, nameToken, ...selectClauses(tokens, k + 1, end) });
      }
      i = end;
    }
  }
  return entries;
}

/**
 * @param {CobolToken[]} tokens
 * @param {number} start
 * @param {number} end
 * @returns {{ status: CobolToken|null, lineSequential: boolean }}
 */
function selectClauses(tokens, start, end) {
  /** @type {CobolToken|null} */
  let status = null;
  let lineSequential = false;
  for (let j = start; j < end; j++) {
    if (isWord(tokens[j], 'STATUS') && !status) {
      let s = j + 1;
      if (isWord(tokens[s], 'IS')) s += 1;
      if (s < end && tokens[s].type === 'word') status = tokens[s];
    } else if (isWord(tokens[j], 'LINE') && isWord(tokens[j + 1], 'SEQUENTIAL')) {
      lineSequential = true;
    }
  }
  return { status, lineSequential };
}

/**
 * Files named after OPEN INPUT or OPEN I-O.
 * @param {CobolContext} ctx
 * @returns {Set<string>}
 */
function filesOpenedForInput(ctx) {
  const opened = new Set();
  for (const statement of ctx.statements) {
    if (statement.verb !== 'OPEN') continue;
    let mode = '';
    for (let k = statement.start + 1; k < statement.end; k++) {
      const token = ctx.tokens[k];
      if (token.type !== 'word') continue;
      if (token.upper === 'INPUT' || token.upper === 'OUTPUT' || token.upper === 'I-O' || token.upper === 'EXTEND') {
        mode = token.upper;
      } else if (mode === 'INPUT' || mode === 'I-O') {
        opened.add(token.upper);
      }
    }
  }
  return opened;
}

/** @param {string} value */
function isLengthStatus(value) {
  const trimmed = value.trim();
  return trimmed === '04' || trimmed === '06';
}

/**
 * @param {CobolToken|undefined} token
 * @returns {boolean}
 */
function isLengthStatusLiteral(token) {
  return token !== undefined && (token.type === 'string' || token.type === 'number') && isLengthStatus(token.value);
}

const STATUS_WINDOW = 12;
const EVALUATE_SCAN_LIMIT = 5000;

/**
 * Does the PROCEDURE DIVISION compare the status item (or an 88-level on it)
 * with "04" / "06"?
 * @param {CobolContext} ctx
 * @param {string} statusName
 * @returns {boolean}
 */
function statusChecksLength(ctx, statusName) {
  const { tokens } = ctx;
  const item = ctx.symbols.resolve({ name: statusName });
  const conditionNames = new Set();
  for (const condition of item?.conditions ?? []) {
    if (condition.values.some(isLengthStatus)) conditionNames.add(condition.name);
  }
  for (const range of rangesOf(ctx.ranges, 'PROCEDURE')) {
    for (let i = range.start; i < range.end; i++) {
      const token = tokens[i];
      if (token.type !== 'word') continue;
      if (conditionNames.has(token.upper)) return true;
      if (token.upper !== statusName) continue;
      if (windowHasLengthStatus(tokens, i, range.start, range.end)) return true;
      if (isWord(tokens[i - 1], 'EVALUATE') && evaluateHasLengthStatus(tokens, i, range.end)) return true;
    }
  }
  return false;
}

/**
 * @param {CobolToken[]} tokens
 * @param {number} at
 * @param {number} start
 * @param {number} end
 * @returns {boolean}
 */
function windowHasLengthStatus(tokens, at, start, end) {
  for (let k = at + 1; k < Math.min(end, at + STATUS_WINDOW); k++) {
    if (tokens[k].type === 'period') break;
    if (isLengthStatusLiteral(tokens[k])) return true;
  }
  for (let k = at - 1; k >= Math.max(start, at - STATUS_WINDOW); k--) {
    if (tokens[k].type === 'period') break;
    if (isLengthStatusLiteral(tokens[k])) return true;
  }
  return false;
}

/**
 * EVALUATE status ... WHEN "04" ... END-EVALUATE.
 * @param {CobolToken[]} tokens
 * @param {number} subject
 * @param {number} end
 * @returns {boolean}
 */
function evaluateHasLengthStatus(tokens, subject, end) {
  let depth = 0;
  const limit = Math.min(end, subject + EVALUATE_SCAN_LIMIT);
  for (let k = subject + 1; k < limit; k++) {
    const token = tokens[k];
    if (token.type === 'period') return false;
    if (isWord(token, 'EVALUATE')) depth += 1;
    else if (isWord(token, 'END-EVALUATE')) {
      if (depth === 0) return false;
      depth -= 1;
    } else if (depth === 0 && isLengthStatusLiteral(token)) {
      const prev = tokens[k - 1];
      if (isWord(prev, 'WHEN') || isWord(prev, 'THRU') || isWord(prev, 'THROUGH') || isWord(prev, 'ALSO') || isWord(prev, 'OR')) {
        return true;
      }
    }
  }
  return false;
}

// ------------------------------------------------------- columns 73-80 ---

const OVERFLOW_KEYWORDS = new Set([
  ...VERBS, 'TO', 'FROM', 'GIVING', 'INTO', 'BY', 'THEN', 'ELSE', 'END-IF', 'END-EVALUATE', 'END-PERFORM',
  'AND', 'OR', 'NOT', 'PIC', 'PICTURE', 'VALUE', 'OCCURS', 'USING', 'UNTIL', 'VARYING', 'WHEN', 'OTHER',
  'RUN', 'SECTION', 'DIVISION', 'EQUAL', 'GREATER', 'LESS', 'THAN', 'ZERO', 'ZEROS', 'ZEROES', 'SPACE',
  'SPACES', 'TRUE', 'FALSE', 'ROUNDED', 'SIZE', 'ERROR', 'RETURNING', 'PROGRAM', 'NEXT', 'SENTENCE',
]);

/** @param {CobolContext} ctx */
function checkOverflowArea(ctx) {
  for (const overflow of ctx.lex.overflow) {
    if (overflow.afterComment || !isCodeLike(overflow.text)) continue;
    const shown = overflow.text.trim();
    const excerpt = shown.length > 48 ? `${shown.slice(0, 45)}...` : shown;
    ctx.sink.add('ALZ-COB-014', {
      line: overflow.line,
      column: overflow.col,
      endColumn: overflow.col + overflow.text.trimEnd().length,
      message: `Columns 73-80 contain '${escapeInvisible(excerpt)}', which looks like code but is ignored by the compiler: `
        + 'the statement a reviewer reads is not the one that runs.',
    });
  }
}

/**
 * Text in the identification area that looks like code rather than a
 * sequence number or change tag (CHG0042, 00012300).
 * @param {string} text
 * @returns {boolean}
 */
export function isCodeLike(text) {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '=' || ch === '<' || ch === '>') return true;
  }
  const words = splitBlanks(text);
  for (const word of words) {
    if (word === '.') return true;
    let end = word.length;
    while (end > 0 && (word[end - 1] === '.' || word[end - 1] === ',' || word[end - 1] === ';')) end--;
    if (OVERFLOW_KEYWORDS.has(word.slice(0, end).toUpperCase())) return true;
  }
  return words.length >= 2 && words.some((word) => word.endsWith('.'));
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function splitBlanks(text) {
  const words = [];
  let start = -1;
  for (let i = 0; i <= text.length; i++) {
    const blank = i === text.length || isBlankCode(text.charCodeAt(i));
    if (blank && start !== -1) {
      words.push(text.slice(start, i));
      start = -1;
    } else if (!blank && start === -1) {
      start = i;
    }
  }
  return words;
}
