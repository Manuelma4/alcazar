/**
 * Language-independent rules: Trojan Source bidi controls (ALZ-GEN-001),
 * invisible characters and homoglyph identifiers (ALZ-GEN-002) and secret
 * material (ALZ-GEN-003). All scanners are single-pass and regex-free.
 */
import {
  BIDI_NAMES, MAX_SNIPPET, escapeInvisible, formatCodePoint, invisibleName, isAsciiLetterCode,
  isDigitCode, isNonAsciiLetter,
} from './text.mjs';

/** @typedef {import('./finding.mjs').FindingSink} FindingSink */

/**
 * @typedef {object} IdentifierToken
 * @property {string} value
 * @property {number} line
 * @property {number} col
 * @property {number} endLine
 * @property {number} endCol
 */

/**
 * Run every generic rule.
 * @param {string[]} lines
 * @param {FindingSink} sink
 * @param {IdentifierToken[]} identifiers identifier tokens from the language lexer
 */
export function scanGeneric(lines, sink, identifiers) {
  for (let i = 0; i < lines.length; i++) {
    scanSpecialCharacters(lines[i], i + 1, sink);
    scanSecrets(lines[i], i + 1, sink);
  }
  scanIdentifiers(identifiers, sink);
}

/**
 * @param {string} text
 * @param {number} line
 * @param {FindingSink} sink
 */
function scanSpecialCharacters(text, line, sink) {
  /** @type {{ col: number, names: Set<string>, count: number } | null} */
  let bidi = null;
  /** @type {{ col: number, names: Set<string>, count: number } | null} */
  let invisible = null;
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code < 0xad) continue;
    const col = i + 1;
    // Astral invisibles too (tags, variation selectors supplement…).
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      code = /** @type {number} */ (text.codePointAt(i));
      if (code > 0xffff) i += 1;
    }
    const bidiName = BIDI_NAMES.get(code);
    if (bidiName) {
      bidi ??= { col, names: new Set(), count: 0 };
      bidi.count += 1;
      bidi.names.add(`${formatCodePoint(code)} ${bidiName}`);
      continue;
    }
    const name = invisibleName(code);
    if (name) {
      invisible ??= { col, names: new Set(), count: 0 };
      invisible.count += 1;
      invisible.names.add(`${formatCodePoint(code)} ${name}`);
    }
  }
  if (bidi) {
    sink.add('ALZ-GEN-001', {
      line,
      column: bidi.col,
      message: `${plural(bidi.count, 'bidirectional control character')} (${[...bidi.names].join(', ')}): `
        + 'the text a reviewer sees is reordered and is not what the compiler reads (Trojan Source, CVE-2021-42574).',
    });
  }
  if (invisible) {
    sink.add('ALZ-GEN-002', {
      line,
      column: invisible.col,
      message: `${plural(invisible.count, 'invisible character')} (${[...invisible.names].join(', ')}): `
        + 'hidden characters can make two different names or strings look identical.',
    });
  }
}

/**
 * @param {IdentifierToken[]} identifiers
 * @param {FindingSink} sink
 */
function scanIdentifiers(identifiers, sink) {
  for (const token of identifiers) {
    const letter = firstNonAsciiLetter(token.value);
    if (letter === null) continue;
    sink.addAt('ALZ-GEN-002', token,
      `Identifier '${escapeInvisible(token.value)}' contains the non-ASCII letter '${String.fromCodePoint(letter)}' `
      + `(${formatCodePoint(letter)}): it can impersonate an ASCII name (homoglyph) and target a different variable than the one reviewed.`);
  }
}

/**
 * @param {string} value
 * @returns {number|null} code point of the first non-ASCII letter
 */
function firstNonAsciiLetter(value) {
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 128) continue;
    const cp = /** @type {number} */ (value.codePointAt(i));
    if (isNonAsciiLetter(cp)) return cp;
    if (cp > 0xffff) i++;
  }
  return null;
}

/**
 * @param {string} text
 * @param {number} line
 * @param {FindingSink} sink
 */
function scanSecrets(text, line, sink) {
  for (const hit of findSecrets(text)) {
    sink.add('ALZ-GEN-003', {
      line,
      column: hit.start + 1,
      endColumn: hit.end + 1,
      message: `${hit.kind} found in source: treat it as compromised, rotate it and load it from a secrets manager.`,
      snippet: redact(text, hit.start, hit.end),
    });
  }
}

/**
 * @typedef {{ kind: string, start: number, end: number }} SecretHit
 */

/**
 * Locate secret patterns in one line.
 * @param {string} text
 * @returns {SecretHit[]}
 */
export function findSecrets(text) {
  /** @type {SecretHit[]} */
  const hits = [];
  findPemKeys(text, hits);
  findAwsKeyIds(text, hits);
  findGitHubTokens(text, hits);
  findSlackTokens(text, hits);
  return hits.sort((a, b) => a.start - b.start);
}

/** @param {string} text @param {SecretHit[]} hits */
function findPemKeys(text, hits) {
  let from = 0;
  let tail = -2;
  for (;;) {
    const start = text.indexOf('-----BEGIN ', from);
    if (start === -1) return;
    // The trailer position is reused while it is still ahead: keeps this linear.
    if (tail < start) tail = text.indexOf('PRIVATE KEY-----', start);
    if (tail === -1) return;
    const nextDashes = text.indexOf('-----', start + 11);
    if (nextDashes === tail + 11) {
      hits.push({ kind: 'PEM private key block', start, end: tail + 16 });
    }
    from = start + 11;
  }
}

/** @param {string} text @param {SecretHit[]} hits */
function findAwsKeyIds(text, hits) {
  let from = 0;
  for (;;) {
    const start = text.indexOf('AKIA', from);
    if (start === -1) return;
    from = start + 4;
    if (start > 0 && isUpperAlnum(text.charCodeAt(start - 1))) continue;
    let end = start + 4;
    while (end < text.length && end < start + 20 && isUpperAlnum(text.charCodeAt(end))) end++;
    if (end !== start + 20 || isUpperAlnum(text.charCodeAt(end))) continue;
    hits.push({ kind: 'AWS access key id', start, end });
  }
}

/** @param {string} text @param {SecretHit[]} hits */
function findGitHubTokens(text, hits) {
  let from = 0;
  for (;;) {
    const start = text.indexOf('gh', from);
    if (start === -1) return;
    from = start + 2;
    if (!'pousr'.includes(text[start + 2] ?? ' ') || text[start + 3] !== '_') continue;
    if (start > 0 && isAlnum(text.charCodeAt(start - 1))) continue;
    let end = start + 4;
    while (end < text.length && isAlnum(text.charCodeAt(end))) end++;
    if (end - (start + 4) >= 36) hits.push({ kind: 'GitHub token', start, end });
    from = end;
  }
}

/** @param {string} text @param {SecretHit[]} hits */
function findSlackTokens(text, hits) {
  let from = 0;
  for (;;) {
    const start = text.indexOf('xox', from);
    if (start === -1) return;
    from = start + 3;
    if (!'abprs'.includes(text[start + 3] ?? ' ') || text[start + 4] !== '-') continue;
    let end = start + 5;
    while (end < text.length && (isAlnum(text.charCodeAt(end)) || text.charCodeAt(end) === 45)) end++;
    if (end - (start + 5) >= 10) hits.push({ kind: 'Slack token', start, end });
    from = end;
  }
}

/**
 * Replace the secret with asterisks, keeping its first four characters.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
function redact(text, start, end) {
  const keep = Math.min(4, end - start);
  const redacted = text.slice(0, start + keep) + '*'.repeat(end - start - keep) + text.slice(end);
  return redacted.length > MAX_SNIPPET ? redacted.slice(0, MAX_SNIPPET) : redacted;
}

/** @param {number} code */
function isUpperAlnum(code) {
  return (code >= 65 && code <= 90) || isDigitCode(code);
}

/** @param {number} code */
function isAlnum(code) {
  return isAsciiLetterCode(code) || isDigitCode(code);
}

/**
 * @param {number} count
 * @param {string} noun
 * @returns {string}
 */
function plural(count, noun) {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}
