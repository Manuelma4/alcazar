/**
 * COBOL lexer: fixed / free / variable reference format, continuation lines,
 * inline comments, literals with doubled-quote escapes and PICTURE strings.
 * Hand-written single-pass scanner: linear in the input, no regular
 * expressions on source text.
 */
import {
  isAsciiLetterCode, isBlankCode, isDigitCode, isNonAsciiWordCode, splitLines, stripBom,
} from '../text.mjs';

/**
 * @typedef {'word'|'number'|'string'|'pic'|'punct'|'period'} CobolTokenType
 */

/**
 * @typedef {object} CobolToken
 * @property {CobolTokenType} type
 * @property {string} value   source text; for literals the content without quotes
 * @property {string} upper   upper-cased value
 * @property {number} line
 * @property {number} col
 * @property {number} endLine
 * @property {number} endCol  exclusive
 * @property {string} [prefix] literal prefix (X, N, Z, ...)
 */

/**
 * @typedef {object} OverflowText
 * @property {number} line
 * @property {number} col
 * @property {string} text
 * @property {boolean} afterComment  the code area ended in an inline comment
 */

/**
 * @typedef {object} CobolLex
 * @property {'fixed'|'free'} format  format in effect at the top of the file
 * @property {string[]} lines
 * @property {CobolToken[]} tokens
 * @property {import('../suppress.mjs').SourceComment[]} comments
 * @property {number[]} codeLines
 * @property {OverflowText[]} overflow
 */

const FIXED_MARGIN = 72;
const VARIABLE_MARGIN = 250;
const TAB_WIDTH = 8;
const LITERAL_PREFIXES = new Set(['X', 'N', 'NX', 'Z', 'B', 'BX', 'H', 'G', 'U', 'L']);

/**
 * Lex COBOL source.
 * @param {string} source
 * @param {{ format?: 'fixed'|'free' }} [options]
 * @returns {CobolLex}
 */
export function lexCobol(source, options = {}) {
  const lines = splitLines(stripBom(source));
  const format = options.format ?? detectCobolFormat(lines);
  const lexer = new CobolLexer(lines, format);
  lexer.run();
  return {
    format,
    lines,
    tokens: lexer.tokens,
    comments: lexer.comments,
    codeLines: [...lexer.codeLineSet].sort((a, b) => a - b),
    overflow: lexer.overflow,
  };
}

/**
 * Decide fixed vs free format: an explicit directive near the top wins,
 * otherwise sniff the indicator column.
 * @param {string[]} lines
 * @returns {'fixed'|'free'}
 */
export function detectCobolFormat(lines) {
  let seen = 0;
  for (let i = 0; i < lines.length && seen < 50; i++) {
    if (lines[i].trim() === '') continue;
    seen += 1;
    const directive = parseDirective(lines[i], null);
    if (directive?.format) return directive.format;
  }
  return sniffCobolFormat(lines);
}

/**
 * @param {string[]} lines
 * @returns {'fixed'|'free'}
 */
function sniffCobolFormat(lines) {
  let fixed = 0;
  let free = 0;
  const limit = Math.min(lines.length, 2000);
  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (line.length > 80) free += 1;
    if (line.length < 7) continue;
    const indicator = line.charCodeAt(6);
    if (indicator === 32 || indicator === 42 || indicator === 45 || indicator === 47) fixed += 1;
    else if (indicator === 68 || indicator === 100 || indicator === 36) fixed += 0.25;
    else free += 1;
  }
  return free > fixed ? 'free' : 'fixed';
}

/**
 * Recognise compiler directives (>>SOURCE, >>IF ..., $SET ...).
 * @param {string} raw
 * @param {'fixed'|'free'|null} format current format (null: accept both layouts)
 * @returns {{ format?: 'fixed'|'free', margin?: number } | null}
 */
export function parseDirective(raw, format) {
  const body = directiveBody(raw, format);
  if (body === null) return null;
  const upper = body.toUpperCase();
  if (upper.startsWith('>>')) {
    const words = upper.slice(2).split(' ').filter((w) => w !== '');
    if (words[0] === 'SOURCE') return formatFromWords(words.slice(1));
    return {};
  }
  const at = upper.indexOf('SOURCEFORMAT');
  if (at === -1) return {};
  const rest = upper.slice(at + 12).replace('"', ' ').replace("'", ' ').replace('(', ' ');
  return formatFromWords(rest.split(' ').filter((w) => w !== ''));
}

/**
 * Directives start with ">>" (any column) or "$" + letter (column 7 in fixed
 * format, anywhere in free format: $SET, $IF ...).
 * @param {string} raw
 * @param {'fixed'|'free'|null} format
 * @returns {string|null} the directive text, or null when the line is not one
 */
function directiveBody(raw, format) {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('>>')) return trimmed;
  const isDollar = (text) => text.charCodeAt(0) === 36 && isAsciiLetterCode(text.charCodeAt(1));
  if (format !== 'fixed' && isDollar(trimmed)) return trimmed;
  if (format !== 'free' && raw.length > 6) {
    const area = raw.slice(6).trimStart();
    if (area.startsWith('>>') || (raw[6] === '$' && isDollar(area))) return area;
  }
  return null;
}

/**
 * @param {string[]} words
 * @returns {{ format?: 'fixed'|'free', margin?: number }}
 */
function formatFromWords(words) {
  for (const word of words) {
    const clean = word.replace('"', '').replace("'", '').replace(')', '').replace('.', '');
    if (clean === 'FREE') return { format: 'free' };
    if (clean === 'FIXED') return { format: 'fixed', margin: FIXED_MARGIN };
    if (clean === 'VARIABLE') return { format: 'fixed', margin: VARIABLE_MARGIN };
  }
  return {};
}

/**
 * Expand tabs to 8-column stops, keeping a map back to original indexes.
 * @param {string} raw
 * @returns {{ text: string, map: number[]|null }}
 */
function expandTabs(raw) {
  if (!raw.includes('\t')) return { text: raw, map: null };
  let text = '';
  const map = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\t') {
      const width = TAB_WIDTH - (text.length % TAB_WIDTH);
      for (let k = 0; k < width; k++) map.push(i);
      text += ' '.repeat(width);
    } else {
      map.push(i);
      text += raw[i];
    }
  }
  return { text, map };
}

/** @param {number} code */
function isWordCode(code) {
  return isAsciiLetterCode(code) || isDigitCode(code) || code === 45 || code === 95 || isNonAsciiWordCode(code);
}

/** @param {number} code */
function isWordStartCode(code) {
  return isAsciiLetterCode(code) || isDigitCode(code) || code === 95 || isNonAsciiWordCode(code);
}

/** @param {string} value */
function hasLetter(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (!isDigitCode(code) && code !== 46 && code !== 44 && code !== 43 && code !== 45) return true;
  }
  return false;
}

/**
 * @typedef {object} OpenLiteral
 * @property {string} quote
 * @property {string[]} parts
 * @property {number} line
 * @property {number} col
 * @property {number} endLine
 * @property {number} endCol
 * @property {string} prefix
 */

class CobolLexer {
  /**
   * @param {string[]} lines
   * @param {'fixed'|'free'} format
   */
  constructor(lines, format) {
    this.lines = lines;
    this.format = format;
    this.margin = FIXED_MARGIN;
    /** @type {CobolToken[]} */
    this.tokens = [];
    /** @type {import('../suppress.mjs').SourceComment[]} */
    this.comments = [];
    /** @type {OverflowText[]} */
    this.overflow = [];
    /** @type {Set<number>} */
    this.codeLineSet = new Set();
    /** @type {OpenLiteral|null} */
    this.literal = null;
    this.expectPic = false;
    this.glue = false;
    this.lineNo = 0;
    this.lineHasCode = false;
    this.lineCommentSeen = false;
    /** @type {(index: number) => number} */
    this.colOf = (index) => index + 1;
  }

  run() {
    for (let i = 0; i < this.lines.length; i++) {
      this.lineNo = i + 1;
      this.lineHasCode = false;
      this.lineCommentSeen = false;
      const raw = this.lines[i];
      const directive = parseDirective(raw, this.format);
      if (directive && !this.isCommentLine(raw)) {
        this.closeLiteral();
        if (directive.format) {
          this.format = directive.format;
          this.margin = directive.margin ?? FIXED_MARGIN;
        }
        continue;
      }
      if (this.format === 'fixed') this.fixedLine(raw);
      else this.freeLine(raw);
    }
    this.closeLiteral();
  }

  /** @param {string} raw */
  isCommentLine(raw) {
    if (this.format !== 'fixed' || raw.length < 7) return false;
    return raw[6] === '*' || raw[6] === '/';
  }

  /** @param {string} raw */
  fixedLine(raw) {
    const { text, map } = expandTabs(raw);
    this.colOf = map
      ? (index) => (index < map.length ? map[index] : raw.length + index - map.length) + 1
      : (index) => index + 1;
    if (text.length <= 6) return;
    const indicator = text[6];
    if (indicator === '*' || indicator === '/') {
      // The whole line: a justification may run into columns 73-80.
      this.comments.push({ line: this.lineNo, text: text.slice(7), standalone: true });
      return;
    }
    const code = text.slice(7, this.margin);
    if (indicator === '-') this.continuationLine(code);
    else {
      this.closeLiteral();
      this.scan(code, 7, 0);
    }
    if (this.literal) this.literal.parts.push(' '.repeat(Math.max(0, this.margin - 7 - code.length)));
    if (this.lineCommentSeen && text.length > this.margin) {
      const comment = this.comments[this.comments.length - 1];
      comment.text += text.slice(this.margin);
    }
    if (this.margin === FIXED_MARGIN && text.length > FIXED_MARGIN) {
      const over = text.slice(FIXED_MARGIN);
      if (over.trim() !== '') {
        this.overflow.push({
          line: this.lineNo, col: this.colOf(FIXED_MARGIN), text: over, afterComment: this.lineCommentSeen,
        });
      }
    }
  }

  /** @param {string} code */
  continuationLine(code) {
    if (!this.literal) {
      this.glue = true;
      this.scan(code, 7, 0);
      return;
    }
    let k = 0;
    while (k < code.length && isBlankCode(code.charCodeAt(k))) k++;
    if (k < code.length && (code[k] === '"' || code[k] === "'")) {
      this.markCode();
      const next = this.continueLiteral(code, 7, k + 1);
      this.scan(code, 7, next);
    } else {
      this.closeLiteral();
      this.scan(code, 7, 0);
    }
  }

  /** @param {string} raw */
  freeLine(raw) {
    this.colOf = (index) => index + 1;
    this.closeLiteral();
    this.scan(raw, 0, 0);
    this.closeLiteral();
  }

  markCode() {
    this.codeLineSet.add(this.lineNo);
    this.lineHasCode = true;
  }

  /**
   * Tokenize one code area.
   * @param {string} code
   * @param {number} base index of code[0] in the (tab-expanded) line
   * @param {number} start
   */
  scan(code, base, start) {
    let i = start;
    while (i < code.length) {
      const c = code.charCodeAt(i);
      if (isBlankCode(c)) {
        i++;
      } else if (c === 42 && code.charCodeAt(i + 1) === 62) {
        this.comments.push({ line: this.lineNo, text: code.slice(i + 2), standalone: !this.lineHasCode });
        this.lineCommentSeen = true;
        return;
      } else if (this.expectPic) {
        i = this.readPicture(code, base, i);
      } else if (c === 34 || c === 39) {
        i = this.startLiteral(code, base, i, i, '');
      } else if (isWordStartCode(c)) {
        i = this.readWord(code, base, i);
      } else if ((c === 43 || c === 45) && isDigitCode(code.charCodeAt(i + 1))) {
        i = this.readNumber(code, base, i, i + 1);
      } else if (c === 46 && isDigitCode(code.charCodeAt(i + 1))) {
        i = this.readNumber(code, base, i, i);
      } else if (c === 46) {
        // A separator period is followed by a blank or the end of the area;
        // SQL qualified names (SCHEMA.TABLE) keep a plain '.' punctuation token.
        const next = code.charCodeAt(i + 1);
        this.emitSimple(i + 1 >= code.length || !isWordCode(next) ? 'period' : 'punct', '.', base, i, 1);
        i++;
      } else if (c === 44 || c === 59) {
        i++;
      } else {
        i = this.readOperator(code, base, i);
      }
    }
  }

  /**
   * @param {CobolTokenType} type
   * @param {string} value
   * @param {number} base
   * @param {number} index
   * @param {number} length
   * @param {{ keepPic?: boolean, prefix?: string }} [extra]
   */
  emitSimple(type, value, base, index, length, extra = {}) {
    this.emit({
      type,
      value,
      upper: value.toUpperCase(),
      line: this.lineNo,
      col: this.colOf(base + index),
      endLine: this.lineNo,
      endCol: this.colOf(base + index + length - 1) + 1,
    }, extra.keepPic === true);
  }

  /**
   * @param {CobolToken} token
   * @param {boolean} [keepPic]
   */
  emit(token, keepPic = false) {
    this.markCode();
    if (this.glue) {
      this.glue = false;
      const prev = this.tokens[this.tokens.length - 1];
      const joinable = (t) => t && (t.type === 'word' || t.type === 'number');
      if (joinable(prev) && joinable(token) && prev.endLine < token.line) {
        prev.value += token.value;
        prev.upper = prev.value.toUpperCase();
        prev.type = hasLetter(prev.value) ? 'word' : 'number';
        prev.endLine = token.endLine;
        prev.endCol = token.endCol;
        return;
      }
    }
    this.tokens.push(token);
    if (!keepPic) this.expectPic = token.type === 'word' && (token.upper === 'PIC' || token.upper === 'PICTURE');
  }

  /**
   * @param {string} code
   * @param {number} base
   * @param {number} i
   * @returns {number}
   */
  readWord(code, base, i) {
    let j = i;
    while (j < code.length && isWordCode(code.charCodeAt(j))) j++;
    const word = code.slice(i, j);
    const next = code.charCodeAt(j);
    if ((next === 34 || next === 39) && LITERAL_PREFIXES.has(word.toUpperCase())) {
      return this.startLiteral(code, base, j, i, word.toUpperCase());
    }
    if (!hasLetter(word)) return this.readNumber(code, base, i, i);
    this.emitSimple('word', word, base, i, j - i);
    return j;
  }

  /**
   * Numeric literal: [sign] digits [(.|,) digits] [E [sign] digits].
   * @param {string} code
   * @param {number} base
   * @param {number} start  token start (may be the sign)
   * @param {number} digits first digit or decimal point
   * @returns {number}
   */
  readNumber(code, base, start, digits) {
    let j = digits;
    while (j < code.length && isDigitCode(code.charCodeAt(j))) j++;
    const sep = code.charCodeAt(j);
    if ((sep === 46 || sep === 44) && isDigitCode(code.charCodeAt(j + 1))) {
      j++;
      while (j < code.length && isDigitCode(code.charCodeAt(j))) j++;
    }
    const exp = code.charCodeAt(j);
    if ((exp === 69 || exp === 101) && j > digits) {
      let k = j + 1;
      if (code.charCodeAt(k) === 43 || code.charCodeAt(k) === 45) k++;
      if (isDigitCode(code.charCodeAt(k))) {
        while (k < code.length && isDigitCode(code.charCodeAt(k))) k++;
        j = k;
      }
    }
    // Digits glued to letters/hyphens form a word (e.g. paragraph 100-MAIN).
    if (j < code.length && isWordCode(code.charCodeAt(j)) && start === digits) {
      let k = j;
      while (k < code.length && isWordCode(code.charCodeAt(k))) k++;
      this.emitSimple('word', code.slice(start, k), base, start, k - start);
      return k;
    }
    this.emitSimple('number', code.slice(start, j), base, start, j - start);
    return j;
  }

  /**
   * PICTURE character-string: up to the next blank; a trailing separator
   * period / comma / semicolon is not part of it.
   * @param {string} code
   * @param {number} base
   * @param {number} i
   * @returns {number}
   */
  readPicture(code, base, i) {
    let j = i;
    while (j < code.length && !isBlankCode(code.charCodeAt(j))) j++;
    const word = code.slice(i, j);
    if (word.toUpperCase() === 'IS') {
      this.emitSimple('word', word, base, i, j - i, { keepPic: true });
      return j;
    }
    let end = j;
    const last = code.charCodeAt(j - 1);
    if (j - i > 1 && (last === 46 || last === 44 || last === 59)) end = j - 1;
    this.emitSimple('pic', code.slice(i, end), base, i, end - i);
    this.expectPic = false;
    if (end < j && last === 46) this.emitSimple('period', '.', base, end, 1);
    return j;
  }

  /**
   * @param {string} code
   * @param {number} base
   * @param {number} i
   * @returns {number}
   */
  readOperator(code, base, i) {
    const pair = code.slice(i, i + 2);
    if (pair === '**' || pair === '>=' || pair === '<=' || pair === '<>' || pair === '==') {
      this.emitSimple('punct', pair, base, i, 2);
      return i + 2;
    }
    const code0 = code.charCodeAt(i);
    // Keep surrogate pairs together so columns stay meaningful.
    const width = code0 >= 0xd800 && code0 <= 0xdbff && i + 1 < code.length ? 2 : 1;
    this.emitSimple('punct', code.slice(i, i + width), base, i, width);
    return i + width;
  }

  /**
   * @param {string} code
   * @param {number} base
   * @param {number} quoteIndex
   * @param {number} tokenStart
   * @param {string} prefix
   * @returns {number}
   */
  startLiteral(code, base, quoteIndex, tokenStart, prefix) {
    this.markCode();
    this.literal = {
      quote: code[quoteIndex],
      parts: [],
      line: this.lineNo,
      col: this.colOf(base + tokenStart),
      endLine: this.lineNo,
      endCol: this.colOf(base + quoteIndex) + 1,
      prefix,
    };
    return this.continueLiteral(code, base, quoteIndex + 1);
  }

  /**
   * Consume literal content until the closing quote or the end of the area.
   * @param {string} code
   * @param {number} base
   * @param {number} i
   * @returns {number}
   */
  continueLiteral(code, base, i) {
    const literal = /** @type {OpenLiteral} */ (this.literal);
    const quote = literal.quote;
    let segment = i;
    while (i < code.length) {
      if (code[i] !== quote) {
        i++;
        continue;
      }
      if (code[i + 1] === quote) {
        literal.parts.push(code.slice(segment, i + 1));
        i += 2;
        segment = i;
        continue;
      }
      literal.parts.push(code.slice(segment, i));
      literal.endLine = this.lineNo;
      literal.endCol = this.colOf(base + i) + 1;
      this.finishLiteral();
      return i + 1;
    }
    literal.parts.push(code.slice(segment));
    if (code.length > 0) {
      literal.endLine = this.lineNo;
      literal.endCol = this.colOf(base + code.length - 1) + 1;
    }
    return i;
  }

  finishLiteral() {
    const literal = /** @type {OpenLiteral} */ (this.literal);
    this.literal = null;
    const value = literal.parts.join('');
    const token = {
      type: /** @type {CobolTokenType} */ ('string'),
      value,
      upper: value.toUpperCase(),
      line: literal.line,
      col: literal.col,
      endLine: literal.endLine,
      endCol: literal.endCol,
      prefix: literal.prefix,
    };
    this.tokens.push(token);
    this.expectPic = false;
    this.glue = false;
  }

  closeLiteral() {
    if (this.literal) this.finishLiteral();
  }
}
