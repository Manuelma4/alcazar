/**
 * Test helpers: build fixed-format COBOL without counting columns by hand.
 */
import { scan } from '../src/index.mjs';

/**
 * One fixed-format line: `code` starts in column 8 (area A). A line that
 * starts with '*' or '/' becomes a column-7 comment line, '-' a continuation
 * line and 'D ' a debugging line. Text after '|73|' goes to columns 73+.
 * @param {string} text
 * @returns {string}
 */
export function fixedLine(text) {
  let code = text;
  let overflow = '';
  const marker = text.indexOf('|73|');
  if (marker !== -1) {
    code = text.slice(0, marker);
    overflow = text.slice(marker + 4);
  }
  let indicator = ' ';
  if (code.startsWith('*') || code.startsWith('/') || code.startsWith('-') || code.startsWith('D ')) {
    indicator = code[0];
    code = code.slice(1);
  }
  const line = `      ${indicator}${code}`;
  return overflow ? `${line.padEnd(72)}${overflow}` : line;
}

/**
 * @param {string[]} lines
 * @returns {string}
 */
export function fixed(lines) {
  return `${lines.map(fixedLine).join('\n')}\n`;
}

/**
 * A complete fixed-format program.
 * @param {{ environment?: string[], data?: string[], procedure?: string[] }} parts
 * @returns {string}
 */
export function cobolProgram({ environment = [], data = [], procedure = [] }) {
  return fixed([
    'IDENTIFICATION DIVISION.',
    'PROGRAM-ID. TESTPGM.',
    'ENVIRONMENT DIVISION.',
    ...(environment.length > 0 ? ['INPUT-OUTPUT SECTION.', 'FILE-CONTROL.', ...environment] : []),
    'DATA DIVISION.',
    'WORKING-STORAGE SECTION.',
    ...data,
    'PROCEDURE DIVISION.',
    'MAIN-PARA.',
    ...procedure,
    '    STOP RUN.',
  ]);
}

/**
 * Scan COBOL test code.
 * @param {string} source
 * @param {object} [options]
 */
export function scanCobol(source, options = {}) {
  return scan(source, { filename: 'TEST.cbl', ...options });
}

/**
 * Scan free-form Fortran test code.
 * @param {string} source
 * @param {object} [options]
 */
export function scanFortran(source, options = {}) {
  return scan(source, { filename: 'test.f90', ...options });
}

/**
 * Findings of one rule.
 * @param {{ findings: Array<{ ruleId: string }> }} result
 * @param {string} ruleId
 */
export function findingsOf(result, ruleId) {
  return result.findings.filter((finding) => finding.ruleId === ruleId);
}

/**
 * Sorted unique rule ids of a result.
 * @param {{ findings: Array<{ ruleId: string }> }} result
 * @returns {string[]}
 */
export function ruleIds(result) {
  return [...new Set(result.findings.map((finding) => finding.ruleId))].sort();
}
