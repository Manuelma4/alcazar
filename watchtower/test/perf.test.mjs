/**
 * Robustness against pathological input: the analyzer parses untrusted
 * source, so no input may trigger super-linear behaviour (ReDoS-style).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scan } from '../src/index.mjs';

const LENGTH = 200_000;
const BUDGET_MS = 1000;
const repeat = (text) => text.repeat(Math.ceil(LENGTH / text.length)).slice(0, LENGTH);

const PATTERNS = {
  'double quotes': repeat('"'),
  'single quotes': repeat("'"),
  stars: repeat('*'),
  hyphens: repeat('-'),
  'PIC repetition': `       01  X PIC ${repeat('9(')}`,
  'nested parentheses': repeat('('),
  'closing parentheses': repeat(')'),
  ampersands: repeat('&'),
  'comment openers': repeat('*>'),
  'bangs': repeat('!'),
  periods: repeat('.'),
  'dot operators': repeat('.eq.'),
  'unterminated dot operators': repeat('.a'),
  'equality chain': repeat('a == '),
  'logical chain': `if (${repeat('i <= n .and. a(i) > 0 .or. ')}) x = 1`,
  'arithmetic chain': `       COMPUTE WS-TOTAL-AMT = ${repeat('WS-AMT * ')}1`,
  'unary minus chain': `       COMPUTE WS-AMT = ${repeat('- ')}1`,
  'ADD statements': repeat('ADD 1 TO WS-AMT '),
  'EXEC blocks': repeat('EXEC SQL PREPARE S FROM '),
  'DIVISION headers': repeat('DATA DIVISION '),
  'PEM headers': repeat('-----BEGIN '),
  'AWS prefixes': repeat('AKIA'),
  'GitHub prefixes': repeat('ghp_'),
  'Slack prefixes': repeat('xoxb-'),
  'suppression markers': `*> ${repeat('watchtower-ignore ALZ-COB-001, ')}`,
  'unicode letters': repeat('é'),
  'combining marks': repeat('e\u{301}'),
  'astral characters': repeat('\u{1F600}'),
  'bidi controls': repeat(String.fromCodePoint(0x202e)),
  'zero-width characters': repeat(String.fromCodePoint(0x200b)),
  'deep CALL USING': `       CALL "SYSTEM" USING ${repeat('BY ')}`,
  'Fortran declarations': `real :: ${repeat('a(*), ')}`,
  'Fortran I/O list': `write (${repeat('u, ')}) x`,
};

const MULTILINE = {
  'continuation lines': `       MOVE "A\n${'      -    "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n'.repeat(20_000)}`,
  'Fortran continuation lines': `x = 1 + &\n${'  & 1 + &\n'.repeat(20_000)}  1\n`,
  'many short statements': '       ADD 1 TO WS-AMT.\n'.repeat(20_000),
  'many units': 'subroutine s()\nend subroutine s\n'.repeat(10_000),
  'many comment lines': '      * comment\n'.repeat(50_000),
};

const MODES = [
  { language: 'cobol', format: 'fixed' },
  { language: 'cobol', format: 'free' },
  { language: 'fortran', format: 'free' },
  { language: 'fortran', format: 'fixed' },
  { language: 'unknown' },
];

/**
 * @param {string} name
 * @param {string} source
 */
function assertFast(name, source) {
  for (const mode of MODES) {
    const start = performance.now();
    const result = scan(source, { filename: 'input', ...mode });
    const elapsed = performance.now() - start;
    assert.ok(Array.isArray(result.findings));
    assert.ok(elapsed < BUDGET_MS, `${name} as ${mode.language}/${mode.format ?? '-'} took ${elapsed.toFixed(0)} ms`);
  }
}

describe('pathological input completes quickly', () => {
  for (const [name, line] of Object.entries(PATTERNS)) {
    it(`a 200k-character line of ${name}`, () => assertFast(name, `${line}\n`));
  }
  for (const [name, source] of Object.entries(MULTILINE)) {
    it(name, () => assertFast(name, source));
  }

  it('a realistic 2 MB COBOL program', () => {
    const paragraph = [
      '       2000-PROCESS.',
      '           MOVE IN-AMOUNT TO WS-XFER-AMT',
      '           COMPUTE WS-FEE-AMT ROUNDED = WS-XFER-AMT * 0.0025',
      '               ON SIZE ERROR PERFORM 9000-ERR',
      '           END-COMPUTE',
      '           IF WS-XFER-AMT > WS-LIMIT DISPLAY "OVER" END-IF.',
    ].join('\n');
    const program = `       IDENTIFICATION DIVISION.\n       PROGRAM-ID. BIG.\n       DATA DIVISION.\n       WORKING-STORAGE SECTION.\n`
      + '       01  WS-XFER-AMT PIC S9(9)V99.\n       01  WS-FEE-AMT PIC S9(7)V99.\n       01  WS-LIMIT PIC S9(9)V99.\n'
      + `       PROCEDURE DIVISION.\n${`${paragraph}\n`.repeat(Math.floor((2 * 1024 * 1024) / paragraph.length))}`;
    const start = performance.now();
    scan(program, { filename: 'BIG.cbl' });
    assert.ok(performance.now() - start < 3 * BUDGET_MS);
  });

  it('random token soup never throws', () => {
    let seed = 20261020;
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const vocabulary = ['MOVE', 'TO', 'ADD', 'COMPUTE', '=', '*', '/', '(', ')', ':', '.', ',', '"', "'", 'PIC', 'S9(5)V99',
      'VALUE', '01', '88', 'IF', 'END-IF', 'CALL', 'USING', 'EXEC', 'SQL', 'PREPARE', 'FROM', 'END-EXEC', 'DISPLAY', 'WS-PAN',
      'DIVIDE', 'GIVING', 'ROUNDED', 'SIZE', 'ERROR', 'SELECT', 'LINE', 'SEQUENTIAL', 'STATUS', 'OPEN', 'INPUT', 'EVALUATE',
      'WHEN', 'DIVISION', 'COPY', '*>', '\n', '\n      *', '\n      -', 'program', 'end', 'subroutine', 'function', 'contains',
      'interface', 'implicit', 'none', 'real', 'character', '::', '&', ';', '!', '.and.', '==', '<=', 'if', 'then', 'do', 'while',
      'call', 'execute_command_line', 'write', 'read', 'iostat', 'random_number', 'token', 'a', 'i', 'n', '1.0', 'bind', 'c',
      'type', 'common', 'go', 'equivalence', 'parameter', 'dimension', 'x(*)', '%', String.fromCodePoint(0x202e), '\t', '9('];
    for (let iteration = 0; iteration < 300; iteration++) {
      let source = '';
      const length = 5 + Math.floor(random() * 120);
      for (let k = 0; k < length; k++) source += vocabulary[Math.floor(random() * vocabulary.length)] + (random() < 0.7 ? ' ' : '');
      for (const mode of MODES) assert.doesNotThrow(() => scan(source, { filename: 'fuzz', ...mode }), source);
    }
  });
});
