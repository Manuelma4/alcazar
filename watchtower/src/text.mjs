/**
 * Small, allocation-light text helpers shared by the lexers and reporters.
 * Everything here is linear in the input and regex-free on user text, except
 * single-character Unicode property tests.
 */

/** Unicode bidirectional embedding / override / isolate controls. */
export const BIDI_NAMES = new Map([
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
]);

/** Invisible / zero-width characters. */
export const INVISIBLE_NAMES = new Map([
  [0x200b, 'ZERO WIDTH SPACE'],
  [0x200c, 'ZERO WIDTH NON-JOINER'],
  [0x200d, 'ZERO WIDTH JOINER'],
  [0x2060, 'WORD JOINER'],
  [0x180e, 'MONGOLIAN VOWEL SEPARATOR'],
  [0xfeff, 'ZERO WIDTH NO-BREAK SPACE'],
]);

const LETTER_OR_MARK = /^[\p{L}\p{M}]$/u;

/** Maximum snippet length kept on a finding. */
export const MAX_SNIPPET = 400;

/**
 * Split text into lines without their terminators (\n, \r\n or \r).
 * @param {string} source
 * @returns {string[]}
 */
export function splitLines(source) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code === 10 || code === 13) {
      lines.push(source.slice(start, i));
      if (code === 13 && source.charCodeAt(i + 1) === 10) i++;
      start = i + 1;
    }
  }
  lines.push(source.slice(start));
  return lines;
}

/**
 * Remove a leading byte-order mark (editors do not count it as a column).
 * @param {string} source
 * @returns {string}
 */
export function stripBom(source) {
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

/**
 * Horizontal whitespace for tokenizing (space, tab, VT, FF, NBSP).
 * @param {number} code UTF-16 code unit
 * @returns {boolean}
 */
export function isBlankCode(code) {
  return code === 32 || code === 9 || code === 11 || code === 12 || code === 160;
}

/** @param {number} code @returns {boolean} */
export function isDigitCode(code) {
  return code >= 48 && code <= 57;
}

/** @param {number} code @returns {boolean} */
export function isAsciiLetterCode(code) {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/**
 * True for non-ASCII letters / combining marks, and for invisible characters
 * that would otherwise split an identifier silently. Surrogate halves count as
 * identifier characters so astral letters stay inside one token.
 * @param {number} code UTF-16 code unit
 * @returns {boolean}
 */
export function isNonAsciiWordCode(code) {
  if (code < 128) return false;
  if (code >= 0xd800 && code <= 0xdfff) return true;
  if (INVISIBLE_NAMES.has(code)) return true;
  return LETTER_OR_MARK.test(String.fromCharCode(code));
}

/**
 * True when the code point is a letter or mark outside ASCII.
 * @param {number} codePoint
 * @returns {boolean}
 */
export function isNonAsciiLetter(codePoint) {
  return codePoint >= 128 && LETTER_OR_MARK.test(String.fromCodePoint(codePoint));
}

/**
 * Format a code point as U+XXXX.
 * @param {number} codePoint
 * @returns {string}
 */
export function formatCodePoint(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * Split an identifier into its words (on '-' and '_'), uppercased.
 * @param {string} name
 * @returns {string[]}
 */
export function nameParts(name) {
  const parts = [];
  let current = '';
  for (const ch of name.toUpperCase()) {
    if (ch === '-' || ch === '_') {
      if (current) parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * True when `parts` contains `sequence` as consecutive elements.
 * @param {string[]} parts
 * @param {string[]} sequence
 * @returns {boolean}
 */
export function hasPartSequence(parts, sequence) {
  for (let i = 0; i + sequence.length <= parts.length; i++) {
    let match = true;
    for (let j = 0; j < sequence.length; j++) {
      if (parts[i + j] !== sequence[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Make text safe to print on a terminal: control, bidi and invisible
 * characters become U+FFFD (one code unit each, so columns still line up)
 * and tabs become single spaces.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeForTerminal(text) {
  let out = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let replacement = null;
    if (code === 9) replacement = ' ';
    else if (code < 32 || code === 127 || (code >= 0x80 && code < 0xa0)) replacement = '\u{FFFD}';
    else if (BIDI_NAMES.has(code) || INVISIBLE_NAMES.has(code) || code === 0x2028 || code === 0x2029) {
      replacement = '\u{FFFD}';
    }
    if (replacement !== null) {
      out += text.slice(start, i) + replacement;
      start = i + 1;
    }
  }
  return start === 0 ? text : out + text.slice(start);
}

/**
 * Escape characters that must never reach a message verbatim (bidi,
 * invisible, control) as \u{XXXX}; used for identifiers quoted in messages.
 * @param {string} text
 * @returns {string}
 */
export function escapeInvisible(text) {
  let out = '';
  for (const ch of text) {
    const cp = /** @type {number} */ (ch.codePointAt(0));
    if (cp < 32 || cp === 127 || BIDI_NAMES.has(cp) || INVISIBLE_NAMES.has(cp)) {
      out += `\\u{${cp.toString(16).toUpperCase()}}`;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * The text stored as a finding's snippet: the source line, capped.
 * @param {string[]} lines
 * @param {number} line 1-based
 * @returns {string}
 */
export function snippetFor(lines, line) {
  const text = lines[line - 1] ?? '';
  return text.length > MAX_SNIPPET ? text.slice(0, MAX_SNIPPET) : text;
}
