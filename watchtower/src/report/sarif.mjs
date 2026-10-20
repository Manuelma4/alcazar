/**
 * SARIF 2.1.0 output for GitHub code scanning.
 */
import { compareFindings } from '../finding.mjs';
import { RULES } from '../rules.mjs';
import { DOCS_BASE_URI, INFORMATION_URI, TOOL_NAME, VERSION } from '../version.mjs';
import { lineHash } from './hash.mjs';
import { sortResults } from './summary.mjs';

/** @typedef {import('./summary.mjs').FileResult} FileResult */
/** @typedef {import('../finding.mjs').Finding} Finding */
/** @typedef {import('../rules.mjs').RuleMeta} RuleMeta */

export const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';

const LEVELS = { critical: 'error', high: 'error', medium: 'warning', low: 'note', info: 'note' };
const SECURITY_SEVERITY = { critical: '9.5', high: '8.0', medium: '5.5', low: '3.0', info: '1.0' };

/**
 * @param {string} severity
 * @returns {'error'|'warning'|'note'}
 */
export function sarifLevel(severity) {
  return /** @type {'error'|'warning'|'note'} */ (LEVELS[/** @type {keyof LEVELS} */ (severity)] ?? 'warning');
}

/**
 * @param {Readonly<RuleMeta>} rule
 */
function ruleDescriptor(rule) {
  const helpUri = `${DOCS_BASE_URI}${rule.id}.md`;
  const cweNumber = rule.cwe.replace('CWE-', '');
  return {
    id: rule.id,
    name: rule.name,
    shortDescription: { text: rule.title },
    fullDescription: { text: `${rule.summary} ${rule.rationale}` },
    help: {
      text: `${rule.summary}\n\n${rule.rationale}\n\nFix: ${rule.fix}\n\nDocumentation: ${helpUri}`,
      markdown: `**${rule.title}** ([${rule.cwe}](https://cwe.mitre.org/data/definitions/${cweNumber}.html))\n\n`
        + `${rule.summary}\n\n${rule.rationale}\n\n**Fix:** ${rule.fix}\n\n[Rule documentation](${helpUri})`,
    },
    helpUri,
    defaultConfiguration: { level: sarifLevel(rule.severity) },
    properties: {
      tags: ['security', `external/cwe/cwe-${cweNumber}`],
      precision: rule.precision,
      'security-severity': SECURITY_SEVERITY[rule.severity],
    },
  };
}

/**
 * Percent-encode each path segment, keeping '/' separators.
 * @param {string} path
 * @returns {string}
 */
export function encodePath(path) {
  return path.replace(/\\/g, '/').split('/').map((segment) => encodeURIComponent(segment)).join('/');
}

/**
 * Absolute directory path -> file:// URI with a trailing slash.
 * @param {string} root
 * @returns {string}
 */
export function toFileUri(root) {
  let path = root.replace(/\\/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  if (!path.endsWith('/')) path = `${path}/`;
  const encoded = path.split('/').map((segment, index) => (
    index === 1 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)
  )).join('/');
  return `file://${encoded}`;
}

/**
 * @param {Finding} finding
 * @param {string} file
 * @param {Map<string, number>} ruleIndex
 */
function sarifResult(finding, file, ruleIndex) {
  /** @type {Record<string, unknown>} */
  const result = {
    ruleId: finding.ruleId,
    ruleIndex: ruleIndex.get(finding.ruleId) ?? -1,
    level: sarifLevel(finding.severity),
    message: { text: finding.message },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: encodePath(file), uriBaseId: '%SRCROOT%' },
        region: {
          startLine: finding.line,
          startColumn: finding.column,
          endColumn: finding.endColumn,
          snippet: { text: finding.snippet },
        },
      },
    }],
    partialFingerprints: { primaryLocationLineHash: lineHash(finding.ruleId, finding.snippet) },
    properties: { severity: finding.severity, cwe: finding.cwe },
  };
  if (finding.suppression) {
    result.suppressions = [{ kind: 'inSource', justification: finding.suppression.justification }];
  }
  return result;
}

/**
 * Build a SARIF 2.1.0 log.
 * @param {FileResult[]} results
 * @param {{ toolVersion?: string, srcRoot?: string }} [options]
 * @returns {object}
 */
export function toSarif(results, { toolVersion = VERSION, srcRoot } = {}) {
  const ruleIndex = new Map(RULES.map((rule, index) => [rule.id, index]));
  const sarifResults = [];
  for (const result of sortResults(results)) {
    const findings = [...result.findings, ...result.suppressed].sort(compareFindings);
    for (const finding of findings) sarifResults.push(sarifResult(finding, result.file, ruleIndex));
  }
  /** @type {Record<string, unknown>} */
  const run = {
    tool: {
      driver: {
        name: TOOL_NAME,
        semanticVersion: toolVersion,
        version: toolVersion,
        informationUri: INFORMATION_URI,
        rules: RULES.map(ruleDescriptor),
      },
    },
    columnKind: 'utf16CodeUnits',
    results: sarifResults,
  };
  if (srcRoot) run.originalUriBaseIds = { '%SRCROOT%': { uri: toFileUri(srcRoot) } };
  return { $schema: SARIF_SCHEMA, version: '2.1.0', runs: [run] };
}
