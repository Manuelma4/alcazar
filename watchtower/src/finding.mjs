import { RULES_BY_ID } from './rules.mjs';
import { snippetFor } from './text.mjs';

/** @typedef {import('./rules.mjs').Severity} Severity */

/**
 * @typedef {object} Finding
 * @property {string} ruleId
 * @property {Severity} severity
 * @property {string} title
 * @property {string} message
 * @property {number} line        1-based, in the original source
 * @property {number} column      1-based (UTF-16 code units)
 * @property {number} endColumn   exclusive, SARIF semantics
 * @property {string} snippet     the source line (capped)
 * @property {string} cwe
 * @property {string} fix
 * @property {{ justification: string }} [suppression]
 */

/**
 * @typedef {object} Span
 * @property {number} line
 * @property {number} col
 * @property {number} endLine
 * @property {number} endCol      exclusive
 */

/**
 * @typedef {object} Location
 * @property {number} line
 * @property {number} column
 * @property {number} [endColumn]
 */

/**
 * Turn a token span into a single-line location.
 * @param {Span} span
 * @param {string[]} lines
 * @returns {Location}
 */
export function locationOf(span, lines) {
  const endColumn = span.endLine === span.line ? span.endCol : (lines[span.line - 1] ?? '').length + 1;
  return { line: span.line, column: span.col, endColumn };
}

/**
 * @typedef {Location & { message: string, severity?: Severity, snippet?: string }} FindingDetail
 */

/**
 * Build a finding for a rule at a location.
 * @param {string} ruleId
 * @param {FindingDetail} detail
 * @param {string[]} lines original source lines
 * @returns {Finding}
 */
export function makeFinding(ruleId, detail, lines) {
  const rule = RULES_BY_ID.get(ruleId);
  if (!rule) throw new Error(`Unknown rule ${ruleId}`);
  const endColumn = Math.max(detail.endColumn ?? detail.column + 1, detail.column + 1);
  return {
    ruleId,
    severity: detail.severity ?? rule.severity,
    title: rule.title,
    message: detail.message,
    line: detail.line,
    column: detail.column,
    endColumn,
    snippet: detail.snippet ?? snippetFor(lines, detail.line),
    cwe: rule.cwe,
    fix: rule.fix,
  };
}

/**
 * Deterministic order: line, column, rule id, then message.
 * @param {Finding} a
 * @param {Finding} b
 * @returns {number}
 */
export function compareFindings(a, b) {
  return a.line - b.line
    || a.column - b.column
    || compareStrings(a.ruleId, b.ruleId)
    || compareStrings(a.message, b.message);
}

/**
 * Code-unit string comparison (locale independent, hence deterministic).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareStrings(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * Collects findings and drops exact duplicates (same rule, line and column).
 */
export class FindingSink {
  /** @param {string[]} lines */
  constructor(lines) {
    this.lines = lines;
    /** @type {Finding[]} */
    this.findings = [];
    /** @type {Set<string>} */
    this.seen = new Set();
  }

  /**
   * @param {string} ruleId
   * @param {FindingDetail} detail
   */
  add(ruleId, detail) {
    const key = `${ruleId}:${detail.line}:${detail.column}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.findings.push(makeFinding(ruleId, detail, this.lines));
  }

  /**
   * @param {string} ruleId
   * @param {Span} span
   * @param {string} message
   * @param {Severity} [severity]
   */
  addAt(ruleId, span, message, severity) {
    this.add(ruleId, { ...locationOf(span, this.lines), message, severity });
  }
}
