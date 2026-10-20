/**
 * Human-readable terminal report. ANSI colours only when enabled; every
 * piece of source text is sanitised so bidi / control characters in the
 * scanned code cannot rewrite the terminal output.
 */
import { compareFindings } from '../finding.mjs';
import { SEVERITIES, severityRank } from '../rules.mjs';
import { sanitizeForTerminal } from '../text.mjs';
import { TOOL_NAME, VERSION } from '../version.mjs';
import { countAtOrAbove, sortResults, summarize } from './summary.mjs';

/** @typedef {import('./summary.mjs').FileResult} FileResult */
/** @typedef {import('../finding.mjs').Finding} Finding */

const DISPLAY_WIDTH = 110;
const BAR_WIDTH = 32;

const SEVERITY_STYLE = {
  critical: '1;97;41',
  high: '1;31',
  medium: '1;33',
  low: '1;36',
  info: '2',
};

/**
 * @param {boolean} enabled
 */
function painter(enabled) {
  /**
   * @param {string} code
   * @param {string} text
   */
  const paint = (code, text) => (enabled && text !== '' ? `\x1b[${code}m${text}\x1b[0m` : text);
  return {
    bold: (text) => paint('1', text),
    dim: (text) => paint('2', text),
    green: (text) => paint('32', text),
    red: (text) => paint('1;31', text),
    severity: (severity, text) => paint(SEVERITY_STYLE[/** @type {keyof SEVERITY_STYLE} */ (severity)] ?? '0', text),
  };
}

/**
 * Format results as a terminal report.
 * @param {FileResult[]} results
 * @param {{ color?: boolean, failOn?: string }} [options]
 * @returns {string}
 */
export function formatText(results, { color = false, failOn = 'high' } = {}) {
  const p = painter(color);
  const out = [];
  out.push(`${p.bold(TOOL_NAME)} ${VERSION} ${p.dim('· static security analysis for COBOL & Fortran')}`);
  out.push('');
  const sorted = sortResults(results);
  if (sorted.length === 0) out.push(p.dim('No COBOL or Fortran source files found.'), '');
  for (const result of sorted) out.push(...formatFile(result, p));
  out.push(...formatSummary(sorted, p, failOn));
  return `${out.join('\n')}\n`;
}

/**
 * @param {FileResult} result
 * @param {ReturnType<typeof painter>} p
 * @returns {string[]}
 */
function formatFile(result, p) {
  const file = sanitizeForTerminal(result.file);
  const kind = result.format ? `${result.language} · ${result.format}` : result.language;
  const count = result.findings.length;
  const suppressed = result.suppressed.length > 0 ? `, ${result.suppressed.length} suppressed` : '';
  if (count === 0) {
    return [`${p.green('✔')} ${p.bold(file)}  ${p.dim(`${kind} · no findings${suppressed}`)}`];
  }
  const lines = [`${p.red('▸')} ${p.bold(file)}  ${p.dim(`${kind} · ${count} finding${count === 1 ? '' : 's'}${suppressed}`)}`, ''];
  const findings = [...result.findings].sort(compareFindings);
  const gutter = String(Math.max(...findings.map((f) => f.line))).length;
  for (const finding of findings) lines.push(...formatFinding(file, finding, gutter, p), '');
  return lines;
}

/**
 * @param {string} file
 * @param {Finding} finding
 * @param {number} gutter
 * @param {ReturnType<typeof painter>} p
 * @returns {string[]}
 */
function formatFinding(file, finding, gutter, p) {
  const badge = p.severity(finding.severity, ` ${finding.severity.toUpperCase().padEnd(8)} `);
  const lines = [
    `  ${badge} ${p.bold(finding.ruleId)}  ${finding.title}  ${p.dim(finding.cwe)}`,
    `  ${p.dim(`${file}:${finding.line}:${finding.column}`)}`,
  ];
  const view = displayWindow(sanitizeForTerminal(finding.snippet), finding.column, finding.endColumn);
  const number = String(finding.line).padStart(gutter);
  lines.push(`  ${p.dim(`${number} │`)} ${view.text}`);
  if (view.caretLength > 0) {
    lines.push(`  ${p.dim(`${' '.repeat(gutter)} │`)} ${' '.repeat(view.caretStart)}${p.severity(finding.severity, '^'.repeat(view.caretLength))}`);
  }
  lines.push(`  ${sanitizeForTerminal(finding.message)}`);
  lines.push(`  ${p.green('fix:')} ${finding.fix}`);
  return lines;
}

/**
 * Window a long line around the finding so the caret stays visible.
 * @param {string} text
 * @param {number} column
 * @param {number} endColumn
 * @returns {{ text: string, caretStart: number, caretLength: number }}
 */
export function displayWindow(text, column, endColumn) {
  const start0 = column - 1;
  if (start0 > text.length) return { text: text.slice(0, DISPLAY_WIDTH), caretStart: 0, caretLength: 0 };
  let from = 0;
  let to = text.length;
  if (text.length > DISPLAY_WIDTH) {
    from = Math.max(0, Math.min(start0 - 30, text.length - DISPLAY_WIDTH));
    to = Math.min(text.length, from + DISPLAY_WIDTH);
  }
  const prefix = from > 0 ? '…' : '';
  const suffix = to < text.length ? '…' : '';
  const caretStart = start0 - from + prefix.length;
  const visibleEnd = Math.min(endColumn - 1, to);
  const caretLength = Math.max(1, Math.min(visibleEnd - start0, to - start0));
  return { text: prefix + text.slice(from, to).trimEnd() + suffix, caretStart, caretLength };
}

/**
 * @param {FileResult[]} results
 * @param {ReturnType<typeof painter>} p
 * @param {string} failOn
 * @returns {string[]}
 */
function formatSummary(results, p, failOn) {
  const summary = summarize(results);
  const lines = ['─'.repeat(64)];
  const suppressed = summary.suppressed > 0 ? ` · ${summary.suppressed} suppressed` : '';
  lines.push(`${p.bold('Summary')}  ${summary.files} file${summary.files === 1 ? '' : 's'} · ${summary.findings} finding${summary.findings === 1 ? '' : 's'}${suppressed}`);
  lines.push('');
  const max = Math.max(1, ...SEVERITIES.map((s) => summary.bySeverity[s]));
  for (const severity of SEVERITIES) {
    const count = summary.bySeverity[severity];
    const bar = count === 0 ? '' : '█'.repeat(Math.max(1, Math.round((count / max) * BAR_WIDTH)));
    lines.push(`  ${p.severity(severity, severity.padEnd(9))} ${String(count).padStart(4)}  ${p.severity(severity, bar)}`.trimEnd());
  }
  lines.push('');
  lines.push(verdict(results, p, failOn));
  return lines;
}

/**
 * @param {FileResult[]} results
 * @param {ReturnType<typeof painter>} p
 * @param {string} failOn
 * @returns {string}
 */
function verdict(results, p, failOn) {
  if (failOn === 'none') return `${p.dim('●')} Threshold disabled (--fail-on none): report only.`;
  const blocking = countAtOrAbove(results, failOn);
  const valid = severityRank(failOn) >= 0;
  if (!valid) return '';
  if (blocking === 0) return `${p.green('✔ PASS')}  no unsuppressed findings at or above "${failOn}".`;
  return `${p.red('✖ FAIL')}  ${blocking} unsuppressed finding${blocking === 1 ? '' : 's'} at or above "${failOn}": fix them or add a justified watchtower-ignore.`;
}
