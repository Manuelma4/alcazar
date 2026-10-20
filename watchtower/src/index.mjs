/**
 * Watchtower: static security analysis for legacy COBOL and Fortran.
 *
 * Browser-safe entry point: no Node.js APIs are used anywhere under src/
 * (except src/node/, which only the CLI imports).
 *
 *   import { scan, RULES } from './watchtower/src/index.mjs';
 *   const result = scan(code, { filename: 'PAYROLL.cob' });
 */
import { analyzeCobol } from './cobol/index.mjs';
import { detectLanguage, fortranFormatFromName } from './detect.mjs';
import { FindingSink, compareFindings } from './finding.mjs';
import { analyzeFortran } from './fortran/analyze.mjs';
import { scanGeneric } from './generic.mjs';
import { applySuppressions } from './suppress.mjs';
import { splitLines, stripBom } from './text.mjs';

export { VERSION } from './version.mjs';
export { RULES, SEVERITIES } from './rules.mjs';
export { detectLanguage, SOURCE_EXTENSIONS } from './detect.mjs';
export { toSarif } from './report/sarif.mjs';
export { formatText } from './report/text.mjs';
export { summarize, countAtOrAbove } from './report/summary.mjs';

/** @typedef {import('./finding.mjs').Finding} Finding */

/**
 * @typedef {object} ScanOptions
 * @property {string} [filename]   used for language / source-form detection
 * @property {'cobol'|'fortran'|'unknown'} [language] skip detection
 * @property {'fixed'|'free'} [format] skip source-form detection
 * @property {(name: string) => (string|null|undefined)} [resolveCopybook]
 *   returns the text of a COBOL copybook named in COPY (used for typing only)
 */

/**
 * @typedef {object} ScanResult
 * @property {'cobol'|'fortran'|'unknown'} language
 * @property {'fixed'|'free'|null} format
 * @property {Finding[]} findings
 * @property {Finding[]} suppressed
 */

const LANGUAGES = new Set(['cobol', 'fortran', 'unknown']);
const FORMATS = new Set(['fixed', 'free']);

/**
 * Scan one source text.
 * @param {string} source
 * @param {ScanOptions} [options]
 * @returns {ScanResult}
 */
export function scan(source, { filename = 'input', language, format, resolveCopybook } = {}) {
  const text = typeof source === 'string' ? source : String(source ?? '');
  if (language !== undefined && !LANGUAGES.has(language)) {
    throw new TypeError(`language must be 'cobol', 'fortran' or 'unknown' (got ${String(language)})`);
  }
  if (format !== undefined && !FORMATS.has(format)) {
    throw new TypeError(`format must be 'fixed' or 'free' (got ${String(format)})`);
  }
  const detected = language ?? detectLanguage(filename, text);
  const analysis = analyze(detected, text, filename, format, resolveCopybook);
  scanGeneric(analysis.lines, analysis.sink, analysis.identifiers);
  const ordered = [...analysis.sink.findings].sort(compareFindings);
  const { findings, suppressed } = applySuppressions(ordered, analysis.comments, analysis.codeLines);
  return { language: detected, format: analysis.format, findings, suppressed };
}

/**
 * @param {'cobol'|'fortran'|'unknown'} language
 * @param {string} text
 * @param {string} filename
 * @param {'fixed'|'free'|undefined} format
 * @param {ScanOptions['resolveCopybook']} resolveCopybook
 */
function analyze(language, text, filename, format, resolveCopybook) {
  if (language === 'cobol') return analyzeCobol(text, { format, resolveCopybook });
  if (language === 'fortran') return analyzeFortran(text, { format: format ?? fortranFormatFromName(filename) });
  const lines = splitLines(stripBom(text));
  return {
    format: null,
    lines,
    sink: new FindingSink(lines),
    comments: [],
    codeLines: [],
    identifiers: [],
  };
}
