import { SEVERITIES, severityRank } from '../rules.mjs';
import { compareStrings } from '../finding.mjs';

/** @typedef {import('../finding.mjs').Finding} Finding */

/**
 * @typedef {object} FileResult
 * @property {string} file
 * @property {'cobol'|'fortran'|'unknown'} language
 * @property {'fixed'|'free'|null} format
 * @property {Finding[]} findings
 * @property {Finding[]} suppressed
 */

/**
 * @typedef {object} Summary
 * @property {number} files
 * @property {number} findings
 * @property {number} suppressed
 * @property {Record<import('../rules.mjs').Severity, number>} bySeverity
 * @property {Record<string, number>} byRule
 */

/**
 * Totals over a set of file results (suppressed findings are counted apart).
 * @param {FileResult[]} results
 * @returns {Summary}
 */
export function summarize(results) {
  /** @type {Record<string, number>} */
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0]));
  /** @type {Map<string, number>} */
  const byRule = new Map();
  let findings = 0;
  let suppressed = 0;
  for (const result of results) {
    for (const finding of result.findings) {
      findings += 1;
      bySeverity[finding.severity] = (bySeverity[finding.severity] ?? 0) + 1;
      byRule.set(finding.ruleId, (byRule.get(finding.ruleId) ?? 0) + 1);
    }
    suppressed += result.suppressed.length;
  }
  const ruleCounts = Object.fromEntries([...byRule.entries()].sort((a, b) => compareStrings(a[0], b[0])));
  return {
    files: results.length,
    findings,
    suppressed,
    bySeverity: /** @type {Summary['bySeverity']} */ (bySeverity),
    byRule: ruleCounts,
  };
}

/**
 * Unsuppressed findings at or above a severity threshold ('none' never counts).
 * @param {FileResult[]} results
 * @param {string} threshold
 * @returns {number}
 */
export function countAtOrAbove(results, threshold) {
  if (threshold === 'none') return 0;
  const minimum = severityRank(threshold);
  let count = 0;
  for (const result of results) {
    for (const finding of result.findings) if (severityRank(finding.severity) >= minimum) count += 1;
  }
  return count;
}

/**
 * Results ordered by file path (code-unit order, deterministic).
 * @param {FileResult[]} results
 * @returns {FileResult[]}
 */
export function sortResults(results) {
  return [...results].sort((a, b) => compareStrings(a.file, b.file));
}
