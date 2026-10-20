// SPDX-License-Identifier: Apache-2.0
// Fuzzing Watchtower: thousands of random sources stitched from COBOL and
// Fortran fragments, stray quotes, column-7 indicators, continuation marks
// and Unicode must never crash or stall the analyzer, and every finding must
// point inside the source it came from.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RULES, scan, summarize, toSarif } from '../src/index.mjs';

const RULE_IDS = new Set(RULES.map((r) => r.id));
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const UNICODE = [0x202e, 0x2066, 0x200b, 0xfeff, 0xe9, 0x416, 0x1f642].map((c) => String.fromCodePoint(c));

const COBOL = [
  '       IDENTIFICATION DIVISION.\n', '       PROCEDURE DIVISION.\n', '       DATA DIVISION.\n', 'WORKING-STORAGE SECTION.\n',
  'MOVE ', ' TO ', 'PIC S9(5)V99', 'PIC 9(3)', 'PIC X(10)', 'PIC X ANY LENGTH', 'COMP-3', 'COMP-1', 'COMPUTE ', ' = ', '+', '/',
  'ON SIZE ERROR ', 'END-COMPUTE', 'CALL ', '"SYSTEM" ', 'USING ', 'EXEC SQL ', 'PREPARE S1 ', 'FROM :WS-SQL ', 'END-EXEC',
  '*>', '"', "'", '.', '\n', '      *', '      -', '      D', '01 ', '05 ', '77 ', '88 ', 'VALUE ', 'OCCURS 10 ', 'REDEFINES ',
  'COPY ', 'SELECT F ', 'ASSIGN TO "X" ', 'ORGANIZATION IS LINE SEQUENTIAL ', 'FILE STATUS IS ', 'READ ', 'OPEN INPUT F ',
  'DISPLAY ', 'ALTER ', 'DIVIDE ', ' BY ', ' GIVING ', 'ROUNDED ', 'WS-AMOUNT ', 'WS-PASSWORD ', 'WS-PAN ', '(', ')', ':',
  ' ', '        ', '\t', '>>SOURCE FORMAT IS FREE\n', '$SET SOURCEFORMAT"FREE"\n', '000100', 'watchtower-ignore ALZ-COB-006 -- ok',
];
const FORTRAN = [
  'program p\n', 'end program\n', 'module m\n', 'contains\n', 'subroutine s(a, n)\n', 'function f(x) result(y)\n',
  'implicit none\n', 'real :: ', 'real*4 ', 'double precision ', 'integer, intent(in) :: ', 'dimension(*) ', 'common /blk/ ',
  'equivalence (a, b)\n', 'if (', ' .and. ', ' .or. ', ' == ', ' /= ', '0.0', '1.d0', ') then\n', 'end if\n', 'call system(',
  'execute_command_line(', 'random_number(', 'write(*,', 'read(u, fmt)', 'iostat=ios', 'open(newunit=u', '!', '&', ';', '"',
  "'", '\n', 'C', '     1', 'bind(C)', 'password', 'token', 'a(i)', 'i <= n', 'goto 10\n', '10 continue\n', '#if 0\n',
  'watchtower-ignore ALZ-FOR-002 -- ok',
];

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSource(rand) {
  const cobol = rand() < 0.5;
  const pieces = cobol ? COBOL : FORTRAN;
  let source = '';
  const target = Math.floor(rand() * 3000);
  while (source.length < target) {
    const r = rand();
    if (r < 0.03) source += UNICODE[Math.floor(rand() * UNICODE.length)];
    else if (r < 0.06) source += String.fromCharCode(Math.floor(rand() * 128));
    else source += pieces[Math.floor(rand() * pieces.length)];
  }
  const extension = cobol ? (rand() < 0.5 ? '.cob' : '.cpy') : ['.f90', '.f', '.F90'][Math.floor(rand() * 3)];
  return { source, filename: `fuzz${extension}` };
}

function checkFinding(finding, lines) {
  assert.ok(RULE_IDS.has(finding.ruleId), finding.ruleId);
  assert.ok(SEVERITIES.has(finding.severity), finding.severity);
  assert.ok(Number.isInteger(finding.line) && finding.line >= 1 && finding.line <= lines, `line ${finding.line}/${lines}`);
  assert.ok(Number.isInteger(finding.column) && finding.column >= 1, `column ${finding.column}`);
  assert.equal(typeof finding.message, 'string');
}

describe('Watchtower under fuzzing', () => {
  for (const seed of [101, 202, 303]) {
    it(`survives 500 random sources (seed ${seed})`, () => {
      const rand = prng(seed);
      const results = [];
      let slowest = 0;
      for (let i = 0; i < 500; i += 1) {
        const { source, filename } = randomSource(rand);
        const started = performance.now();
        const result = scan(source, { filename });
        slowest = Math.max(slowest, performance.now() - started);
        const lines = source.split(/\r\n|\r|\n/).length;
        for (const f of [...result.findings, ...result.suppressed]) checkFinding(f, lines);
        results.push({ file: filename, ...result });
      }
      assert.ok(slowest < 500, `slowest scan took ${Math.round(slowest)} ms`);
      // The fragments must actually trigger rules, or the fuzzer proves little.
      const fired = new Set(results.flatMap((r) => r.findings.map((f) => f.ruleId)));
      assert.ok(fired.size >= 10, `only ${fired.size} rules fired: ${[...fired].join(' ')}`);
      const sarif = toSarif(results);
      assert.equal(sarif.version, '2.1.0');
      assert.doesNotThrow(() => JSON.stringify(sarif));
      assert.equal(summarize(results).files, 500);
    });
  }
});
