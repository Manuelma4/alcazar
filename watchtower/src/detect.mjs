import { isAsciiLetterCode, isDigitCode, splitLines } from './text.mjs';

const COBOL_EXTENSIONS = new Set(['.cob', '.cbl', '.cpy', '.cobol']);
const FORTRAN_FREE_EXTENSIONS = new Set(['.f90', '.f95', '.f03', '.f08', '.f18']);
const FORTRAN_FIXED_EXTENSIONS = new Set(['.f', '.for', '.ftn', '.f77']);

/** Extensions the CLI picks up when walking directories. */
export const SOURCE_EXTENSIONS = new Set([
  ...COBOL_EXTENSIONS, ...FORTRAN_FREE_EXTENSIONS, ...FORTRAN_FIXED_EXTENSIONS,
]);

/** How much of a file content sniffing looks at. */
const SNIFF_CHARS = 64 * 1024;

const COBOL_SIGNALS = [
  'IDENTIFICATION DIVISION', 'ID DIVISION', 'PROCEDURE DIVISION', 'DATA DIVISION',
  'ENVIRONMENT DIVISION', 'PROGRAM-ID', 'WORKING-STORAGE SECTION', 'LINKAGE SECTION',
  'FILE-CONTROL', 'END PROGRAM',
];

const FORTRAN_LINE_STARTS = [
  'program ', 'module ', 'submodule', 'subroutine ', 'function ', 'implicit none', 'end program',
  'end module', 'end subroutine', 'end function', 'contains', 'use ', 'integer ::', 'integer,',
  'real ::', 'real(', 'real,', 'character(', 'character ::', 'logical ::', 'pure ', 'elemental ',
  'recursive ', 'block data', 'end do', 'end if', 'call ',
];

/**
 * Lower-cased file extension including the dot ('' when there is none).
 * @param {string} filename
 * @returns {string}
 */
export function extensionOf(filename) {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  const base = filename.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * Detect the language from the file extension, then by content sniffing.
 * @param {string} [filename]
 * @param {string} [source]
 * @returns {'cobol'|'fortran'|'unknown'}
 */
export function detectLanguage(filename = '', source = '') {
  const ext = extensionOf(filename);
  if (COBOL_EXTENSIONS.has(ext)) return 'cobol';
  if (FORTRAN_FREE_EXTENSIONS.has(ext) || FORTRAN_FIXED_EXTENSIONS.has(ext)) return 'fortran';
  return sniffLanguage(source);
}

/**
 * Fortran source form implied by the extension, or null when unknown.
 * @param {string} filename
 * @returns {'free'|'fixed'|null}
 */
export function fortranFormatFromName(filename) {
  const ext = extensionOf(filename);
  if (FORTRAN_FREE_EXTENSIONS.has(ext)) return 'free';
  if (FORTRAN_FIXED_EXTENSIONS.has(ext)) return 'fixed';
  return null;
}

/**
 * Guess the language of extension-less text (e.g. code pasted in a browser).
 * @param {string} source
 * @returns {'cobol'|'fortran'|'unknown'}
 */
export function sniffLanguage(source) {
  const sample = source.slice(0, SNIFF_CHARS);
  const upper = sample.toUpperCase();
  let cobol = 0;
  for (const signal of COBOL_SIGNALS) if (upper.includes(signal)) cobol += 2;
  let fortran = 0;
  for (const raw of splitLines(sample).slice(0, 2000)) {
    const line = raw.trim().toLowerCase();
    if (looksLikeCobolDataEntry(line)) cobol += 1;
    for (const start of FORTRAN_LINE_STARTS) {
      if (line.startsWith(start)) {
        fortran += 1;
        break;
      }
    }
  }
  if (cobol === 0 && fortran === 0) return 'unknown';
  return cobol >= fortran ? 'cobol' : 'fortran';
}

/**
 * "01  WS-X  PIC X(10)." style line (lower-cased, trimmed).
 * @param {string} line
 * @returns {boolean}
 */
function looksLikeCobolDataEntry(line) {
  if (line.length < 8 || !isDigitCode(line.charCodeAt(0)) || !isDigitCode(line.charCodeAt(1))) return false;
  if (line.charCodeAt(2) !== 32) return false;
  return line.includes(' pic ') || line.includes(' picture ') || line.endsWith('.');
}

/**
 * Guess fixed vs free source form for Fortran text with no telling extension.
 * @param {string[]} lines
 * @returns {'free'|'fixed'}
 */
export function sniffFortranFormat(lines) {
  let fixed = 0;
  let free = 0;
  const limit = Math.min(lines.length, 1000);
  for (let i = 0; i < limit; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const first = line.charCodeAt(0);
    const second = line.charCodeAt(1);
    if ((first === 67 || first === 99 || first === 42) && !isAsciiLetterCode(second)) {
      fixed += 1; // C / c / * comment in column 1
      continue;
    }
    if (line.trimEnd().endsWith('&')) free += 2;
    let k = 0;
    while (k < line.length && (line.charCodeAt(k) === 32 || isDigitCode(line.charCodeAt(k)))) k++;
    if (line.charCodeAt(k) === 33) continue; // ! comment, neutral
    if (k >= 6) fixed += 1;
    else if (isAsciiLetterCode(line.charCodeAt(k))) free += 1;
  }
  return fixed > free ? 'fixed' : 'free';
}
