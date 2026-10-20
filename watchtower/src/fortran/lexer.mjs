/**
 * Fortran lexer for free form (! comments, & continuation, ; separators)
 * and fixed form (column-1 comments, column-6 continuation, labels in
 * columns 1-5, code in 7-72). Produces statements of tokens that keep the
 * original line/column of every token. Single pass, no regular expressions.
 */
import {
  isAsciiLetterCode, isBlankCode, isDigitCode, isNonAsciiWordCode, splitLines, stripBom,
} from '../text.mjs';
import { sniffFortranFormat } from '../detect.mjs';

/** @typedef {'name'|'number'|'string'|'op'|'dotop'} FortranTokenType */

/**
 * @typedef {object} FortranToken
 * @property {FortranTokenType} type
 * @property {string} value  source text (strings: content without quotes)
 * @property {string} lower  lower-cased value
 * @property {number} line
 * @property {number} col
 * @property {number} endLine
 * @property {number} endCol exclusive
 * @property {string} [prefix] kind prefix (c_char_) or BOZ letter of a literal
 */

/**
 * @typedef {object} FortranStatement
 * @property {FortranToken[]} tokens
 * @property {string|null} label
 * @property {number} line
 */

/**
 * @typedef {object} FortranLex
 * @property {'free'|'fixed'} format
 * @property {string[]} lines
 * @property {FortranStatement[]} statements
 * @property {import('../suppress.mjs').SourceComment[]} comments
 * @property {number[]} codeLines
 */

const FIXED_MARGIN = 72;
const TWO_CHAR_OPERATORS = new Set(['**', '//', '==', '/=', '<=', '>=', '=>', '::']);

/**
 * @param {string} source
 * @param {{ format?: 'free'|'fixed'|null }} [options]
 * @returns {FortranLex}
 */
export function lexFortran(source, options = {}) {
  const lines = splitLines(stripBom(source));
  const format = options.format ?? sniffFortranFormat(lines);
  const lexer = new FortranLexer(lines, format);
  lexer.run();
  return {
    format,
    lines,
    statements: lexer.statements,
    comments: lexer.comments,
    codeLines: [...lexer.codeLineSet].sort((a, b) => a - b),
  };
}

/** @param {number} code */
function isNameStart(code) {
  return isAsciiLetterCode(code) || code === 95 || isNonAsciiWordCode(code);
}

/** @param {number} code */
function isNameChar(code) {
  return isAsciiLetterCode(code) || isDigitCode(code) || code === 95 || code === 36 || isNonAsciiWordCode(code);
}

/**
 * '.' + letters + '.' at index j (a dot operator such as .eq. or .true.)?
 * @param {string} text
 * @param {number} j
 * @returns {number} index after the closing dot, or -1
 */
function dotOperatorEnd(text, j) {
  let k = j + 1;
  while (k < text.length && isAsciiLetterCode(text.charCodeAt(k))) k++;
  return k > j + 1 && text.charCodeAt(k) === 46 ? k + 1 : -1;
}

/**
 * @typedef {object} OpenString
 * @property {string} quote
 * @property {string[]} parts
 * @property {number} line
 * @property {number} col
 * @property {number} endLine
 * @property {number} endCol
 * @property {string} prefix
 */

class FortranLexer {
  /**
   * @param {string[]} lines
   * @param {'free'|'fixed'} format
   */
  constructor(lines, format) {
    this.lines = lines;
    this.format = format;
    /** @type {FortranStatement[]} */
    this.statements = [];
    /** @type {import('../suppress.mjs').SourceComment[]} */
    this.comments = [];
    /** @type {Set<number>} */
    this.codeLineSet = new Set();
    /** @type {FortranToken[]} */
    this.current = [];
    /** @type {string|null} */
    this.label = null;
    /** @type {OpenString|null} */
    this.string = null;
    this.continuing = false;
    this.lineNo = 0;
    this.lineHasCode = false;
  }

  run() {
    for (let i = 0; i < this.lines.length; i++) {
      this.lineNo = i + 1;
      this.lineHasCode = false;
      if (this.format === 'fixed') this.fixedLine(this.lines[i]);
      else this.freeLine(this.lines[i]);
    }
    this.closeString();
    this.endStatement();
  }

  // ------------------------------------------------------------ free form

  /** @param {string} raw */
  freeLine(raw) {
    let i = 0;
    while (i < raw.length && isBlankCode(raw.charCodeAt(i))) i++;
    if (i === raw.length) return;
    if (!this.continuing && !this.string && raw[i] === '#') return; // preprocessor line
    if (this.continuing) {
      if (raw[i] === '!' && !this.string) {
        this.comments.push({ line: this.lineNo, text: raw.slice(i + 1), standalone: true });
        return;
      }
      if (raw[i] === '&') i += 1;
      else if (this.string) i = 0;
    }
    this.continuing = false;
    if (this.string) i = this.continueString(raw, i, raw.length, true);
    this.scan(raw, i, raw.length, true);
    if (!this.continuing) {
      this.closeString();
      this.endStatement();
    }
  }

  // ----------------------------------------------------------- fixed form

  /** @param {string} raw */
  fixedLine(raw) {
    if (raw.trim() === '') return;
    const first = raw[0];
    if ('Cc*!Dd'.includes(first)) {
      this.comments.push({ line: this.lineNo, text: raw.slice(1), standalone: true });
      return;
    }
    if (first === '#') return;
    const layout = fixedLayout(raw);
    if (layout.labelText.trimStart().startsWith('!')) {
      this.comments.push({ line: this.lineNo, text: raw.slice(raw.indexOf('!') + 1), standalone: true });
      return;
    }
    const continuation = layout.cont !== ' ' && layout.cont !== '0' && layout.cont !== '';
    if (!continuation) {
      this.closeString();
      this.endStatement();
      const label = layout.labelText.trim();
      this.label = label !== '' && isAllDigits(label) ? label : null;
    }
    let i = layout.codeStart;
    if (continuation && this.string) i = this.continueString(raw, i, layout.codeEnd, false);
    this.scan(raw, i, layout.codeEnd, false);
    // A string continued in fixed form includes the blanks up to column 72.
    if (this.string) this.string.parts.push(' '.repeat(Math.max(0, layout.marginEnd - Math.max(layout.codeEnd, layout.codeStart))));
  }

  markCode() {
    this.codeLineSet.add(this.lineNo);
    this.lineHasCode = true;
  }

  /**
   * Tokenize raw[i, end).
   * @param {string} raw
   * @param {number} i
   * @param {number} end
   * @param {boolean} free
   */
  scan(raw, i, end, free) {
    while (i < end) {
      const c = raw.charCodeAt(i);
      if (isBlankCode(c)) {
        i++;
      } else if (c === 33) { // !
        this.comments.push({ line: this.lineNo, text: raw.slice(i + 1, free ? raw.length : end), standalone: !this.lineHasCode });
        return;
      } else if (c === 59) { // ;
        this.closeString();
        this.endStatement();
        i++;
      } else if (c === 38 && free) { // &
        let k = i + 1;
        while (k < raw.length && isBlankCode(raw.charCodeAt(k))) k++;
        if (k === raw.length || raw[k] === '!') {
          this.continuing = true;
          if (k < raw.length) this.comments.push({ line: this.lineNo, text: raw.slice(k + 1), standalone: !this.lineHasCode });
          return;
        }
        this.emit('op', '&', i, i + 1);
        i++;
      } else if (c === 34 || c === 39) {
        i = this.startString(raw, i, i, end, '', free);
        if (this.continuing) return;
      } else if (isNameStart(c)) {
        i = this.readName(raw, i, end, free);
        if (this.continuing) return;
      } else if (isDigitCode(c) || (c === 46 && isDigitCode(raw.charCodeAt(i + 1)))) {
        i = this.readNumber(raw, i, end);
      } else if (c === 46) {
        const close = dotOperatorEnd(raw, i);
        if (close !== -1 && close <= end) {
          this.emit('dotop', raw.slice(i, close), i, close);
          i = close;
        } else {
          this.emit('op', '.', i, i + 1);
          i++;
        }
      } else {
        const pair = raw.slice(i, i + 2);
        if (TWO_CHAR_OPERATORS.has(pair) && i + 2 <= end) {
          this.emit('op', pair, i, i + 2);
          i += 2;
        } else {
          const width = c >= 0xd800 && c <= 0xdbff && i + 1 < end ? 2 : 1;
          this.emit('op', raw.slice(i, i + width), i, i + width);
          i += width;
        }
      }
    }
  }

  /**
   * @param {FortranTokenType} type
   * @param {string} value
   * @param {number} start
   * @param {number} end
   */
  emit(type, value, start, end) {
    this.markCode();
    this.current.push({
      type, value, lower: value.toLowerCase(), line: this.lineNo, col: start + 1, endLine: this.lineNo, endCol: end + 1,
    });
  }

  /**
   * @param {string} raw
   * @param {number} i
   * @param {number} end
   * @param {boolean} free
   * @returns {number}
   */
  readName(raw, i, end, free) {
    let j = i;
    while (j < end && isNameChar(raw.charCodeAt(j))) j++;
    const name = raw.slice(i, j);
    const next = raw.charCodeAt(j);
    if (j < end && (next === 34 || next === 39)) {
      const lower = name.toLowerCase();
      if (lower.endsWith('_') || lower === 'b' || lower === 'o' || lower === 'z' || lower === 'x') {
        return this.startString(raw, j, i, end, name, free);
      }
    }
    this.emit('name', name, i, j);
    return j;
  }

  /**
   * digits [. digits] [exponent] [_kind] | . digits ...
   * @param {string} raw
   * @param {number} i
   * @param {number} end
   * @returns {number}
   */
  readNumber(raw, i, end) {
    let j = i;
    while (j < end && isDigitCode(raw.charCodeAt(j))) j++;
    if (j < end && raw.charCodeAt(j) === 46 && dotOperatorEnd(raw, j) === -1) {
      j++;
      while (j < end && isDigitCode(raw.charCodeAt(j))) j++;
    }
    const exp = raw.charCodeAt(j);
    if (j < end && (exp === 101 || exp === 69 || exp === 100 || exp === 68 || exp === 113 || exp === 81)) {
      let k = j + 1;
      if (raw.charCodeAt(k) === 43 || raw.charCodeAt(k) === 45) k++;
      if (k < end && isDigitCode(raw.charCodeAt(k))) {
        while (k < end && isDigitCode(raw.charCodeAt(k))) k++;
        j = k;
      }
    }
    if (j + 1 < end && raw.charCodeAt(j) === 95 && isNameChar(raw.charCodeAt(j + 1))) {
      j++;
      while (j < end && isNameChar(raw.charCodeAt(j))) j++;
    }
    this.emit('number', raw.slice(i, j), i, j);
    return j;
  }

  /**
   * @param {string} raw
   * @param {number} quoteIndex
   * @param {number} tokenStart
   * @param {number} end
   * @param {string} prefix
   * @param {boolean} free
   * @returns {number}
   */
  startString(raw, quoteIndex, tokenStart, end, prefix, free) {
    this.markCode();
    this.string = {
      quote: raw[quoteIndex], parts: [], line: this.lineNo, col: tokenStart + 1,
      endLine: this.lineNo, endCol: quoteIndex + 2, prefix,
    };
    return this.continueString(raw, quoteIndex + 1, end, free);
  }

  /**
   * Consume string content up to the closing quote, or to a free-form
   * continuation '&' that ends the line.
   * @param {string} raw
   * @param {number} i
   * @param {number} end
   * @param {boolean} free
   * @returns {number}
   */
  continueString(raw, i, end, free) {
    const string = /** @type {OpenString} */ (this.string);
    this.markCode();
    let segment = i;
    while (i < end) {
      const ch = raw[i];
      if (ch === string.quote) {
        if (raw[i + 1] === string.quote && i + 1 < end) {
          string.parts.push(raw.slice(segment, i + 1));
          i += 2;
          segment = i;
          continue;
        }
        string.parts.push(raw.slice(segment, i));
        string.endLine = this.lineNo;
        string.endCol = i + 2;
        this.finishString();
        return i + 1;
      }
      if (ch === '&' && free && isBlankTail(raw, i + 1)) {
        string.parts.push(raw.slice(segment, i));
        string.endLine = this.lineNo;
        string.endCol = i + 1;
        this.continuing = true;
        return raw.length;
      }
      i++;
    }
    string.parts.push(raw.slice(segment, end));
    string.endLine = this.lineNo;
    string.endCol = Math.max(end, segment) + 1;
    return i;
  }

  finishString() {
    const string = /** @type {OpenString} */ (this.string);
    this.string = null;
    const value = string.parts.join('');
    this.current.push({
      type: 'string', value, lower: value.toLowerCase(), line: string.line, col: string.col,
      endLine: string.endLine, endCol: string.endCol, prefix: string.prefix,
    });
  }

  closeString() {
    if (this.string) this.finishString();
  }

  endStatement() {
    if (this.current.length === 0) return;
    let tokens = this.current;
    let label = this.label;
    if (this.format === 'free' && tokens.length > 1 && tokens[0].type === 'number'
      && tokens[0].value.length <= 5 && isAllDigits(tokens[0].value)) {
      label = tokens[0].value;
      tokens = tokens.slice(1);
    }
    this.statements.push({ tokens, label, line: tokens[0].line });
    this.current = [];
    this.label = null;
  }
}

/**
 * @param {string} raw
 * @param {number} from
 * @returns {boolean}
 */
function isBlankTail(raw, from) {
  for (let k = from; k < raw.length; k++) if (!isBlankCode(raw.charCodeAt(k))) return false;
  return true;
}

/** @param {string} text */
function isAllDigits(text) {
  for (let i = 0; i < text.length; i++) if (!isDigitCode(text.charCodeAt(i))) return false;
  return text.length > 0;
}

/**
 * Columns of a fixed-form line, including the tab form (label TAB [1-9]code).
 * @param {string} raw
 * @returns {{ labelText: string, cont: string, codeStart: number, codeEnd: number, marginEnd: number }}
 */
function fixedLayout(raw) {
  const tab = raw.indexOf('\t');
  if (tab !== -1 && tab < 6) {
    const after = raw[tab + 1] ?? '';
    const continued = after >= '1' && after <= '9';
    const codeStart = continued ? tab + 2 : tab + 1;
    const marginEnd = codeStart + (FIXED_MARGIN - 6);
    return {
      labelText: raw.slice(0, tab),
      cont: continued ? after : ' ',
      codeStart,
      codeEnd: Math.min(raw.length, marginEnd),
      marginEnd,
    };
  }
  return {
    labelText: raw.slice(0, 5),
    cont: raw.length > 5 ? raw[5] : ' ',
    codeStart: 6,
    codeEnd: Math.min(raw.length, FIXED_MARGIN),
    marginEnd: FIXED_MARGIN,
  };
}
