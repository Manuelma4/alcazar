/**
 * In-source suppressions:
 *
 *   *> watchtower-ignore ALZ-COB-005 -- masked by the caller   (COBOL)
 *   ! watchtower-ignore ALZ-FOR-002, ALZ-FOR-006 -- reason      (Fortran)
 *
 * A comment that trails code applies to its own line; a comment alone on a
 * line applies to the next line that contains code. Secure by default: a
 * suppression without a "-- reason" is not applied.
 */
import { RULES_BY_ID } from './rules.mjs';

export const SUPPRESSION_MARKER = 'watchtower-ignore';

/**
 * @typedef {object} SourceComment
 * @property {number} line        1-based line of the comment
 * @property {string} text        comment text without its delimiter
 * @property {boolean} standalone true when the line has no code
 */

/**
 * @typedef {object} Suppression
 * @property {Set<string>} ids
 * @property {string} justification
 * @property {boolean} valid      false when the reason is missing
 */

/** @typedef {import('./finding.mjs').Finding} Finding */

/**
 * Parse the suppression in a comment, if any.
 * @param {string} text
 * @returns {Suppression|null}
 */
export function parseSuppression(text) {
  const at = text.toLowerCase().indexOf(SUPPRESSION_MARKER);
  if (at === -1) return null;
  const rest = text.slice(at + SUPPRESSION_MARKER.length);
  if (rest !== '' && !isSeparator(rest.charCodeAt(0))) return null;
  const separator = rest.indexOf('--');
  const idText = separator === -1 ? rest : rest.slice(0, separator);
  const justification = separator === -1 ? '' : rest.slice(separator + 2).trim();
  const ids = new Set();
  for (const word of splitIds(idText)) {
    const id = word.toUpperCase();
    if (RULES_BY_ID.has(id)) ids.add(id);
  }
  return { ids, justification, valid: ids.size > 0 && justification !== '' };
}

/**
 * Split on commas and blanks without regular expressions.
 * @param {string} text
 * @returns {string[]}
 */
function splitIds(text) {
  const words = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 44 || isSeparator(code)) {
      if (current) words.push(current);
      current = '';
    } else {
      current += text[i];
    }
  }
  if (current) words.push(current);
  return words;
}

/** @param {number} code */
function isSeparator(code) {
  return code === 32 || code === 9 || code === 12;
}

/**
 * First element of the sorted `lines` greater than `line`, or null.
 * @param {number[]} lines sorted ascending
 * @param {number} line
 * @returns {number|null}
 */
function nextLineAfter(lines, line) {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid] <= line) lo = mid + 1;
    else hi = mid;
  }
  return lo < lines.length ? lines[lo] : null;
}

/**
 * Split findings into kept and suppressed ones.
 * @param {Finding[]} findings
 * @param {SourceComment[]} comments
 * @param {number[]} codeLines sorted line numbers that contain code
 * @returns {{ findings: Finding[], suppressed: Finding[] }}
 */
export function applySuppressions(findings, comments, codeLines) {
  /** @type {Map<number, Suppression[]>} */
  const byLine = new Map();
  for (const comment of comments) {
    const suppression = parseSuppression(comment.text);
    if (!suppression || suppression.ids.size === 0) continue;
    const target = comment.standalone ? nextLineAfter(codeLines, comment.line) : comment.line;
    if (target === null) continue;
    const list = byLine.get(target) ?? [];
    list.push(suppression);
    byLine.set(target, list);
  }
  const kept = [];
  const suppressed = [];
  for (const finding of findings) {
    const candidates = (byLine.get(finding.line) ?? []).filter((s) => s.ids.has(finding.ruleId));
    const applied = candidates.find((s) => s.valid);
    if (applied) {
      suppressed.push({ ...finding, suppression: { justification: applied.justification } });
    } else if (candidates.length > 0) {
      kept.push({
        ...finding,
        message: `${finding.message} (A ${SUPPRESSION_MARKER} comment names this rule but has no "-- reason", so it was not applied.)`,
      });
    } else {
      kept.push(finding);
    }
  }
  return { findings: kept, suppressed };
}
