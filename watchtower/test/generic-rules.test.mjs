import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findSecrets } from '../src/generic.mjs';
import { detectLanguage, scan } from '../src/index.mjs';
import { findingsOf, fixed, scanCobol, scanFortran } from './helpers.mjs';

// Special characters are built from code points so that this file itself
// never contains bidi or invisible characters.
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const PDI = String.fromCodePoint(0x2069);
const ZWSP = String.fromCodePoint(0x200b);
const BOM = String.fromCodePoint(0xfeff);
const CYRILLIC_A = String.fromCodePoint(0x0410);

describe('ALZ-GEN-001 bidirectional controls', () => {
  it('flags bidi controls in comments, literals and code, once per line', () => {
    const source = fixed([`*    check ${RLO}${LRI}admin${PDI}`, `    DISPLAY "A${RLO}B${PDI}"`, '    STOP RUN.']);
    const found = findingsOf(scanCobol(source), 'ALZ-GEN-001');
    assert.equal(found.length, 2);
    assert.equal(found[0].severity, 'critical');
    assert.equal(found[0].line, 1);
    assert.equal(found[0].column, 18);
    assert.match(found[0].message, /U\+202E RIGHT-TO-LEFT OVERRIDE/);
  });

  it('works for Fortran and for unknown languages', () => {
    assert.equal(findingsOf(scanFortran(`x = 1 ! ${RLO}\n`), 'ALZ-GEN-001').length, 1);
    const unknown = scan(`hello ${LRI}world${PDI}\n`, { filename: 'notes.txt' });
    assert.equal(unknown.language, 'unknown');
    assert.equal(findingsOf(unknown, 'ALZ-GEN-001').length, 1);
  });
});

describe('ALZ-GEN-002 invisible characters and homoglyphs', () => {
  it('flags zero-width characters and a BOM that is not at offset 0', () => {
    const source = `program p\nimplicit none\ninteger :: a${ZWSP}b\nprint *, '${BOM}'\nend program p\n`;
    const found = findingsOf(scanFortran(source), 'ALZ-GEN-002');
    assert.deepEqual(found.map((f) => f.line), [3, 4]);
  });

  it('allows a leading byte-order mark', () => {
    const source = `${BOM}program p\nimplicit none\nend program p\n`;
    const result = scanFortran(source);
    assert.equal(findingsOf(result, 'ALZ-GEN-002').length, 0);
    assert.equal(result.findings.length, 0);
  });

  it('flags non-ASCII letters in identifiers but not in comments or literals', () => {
    const source = fixed([
      '01  WS-B' + CYRILLIC_A + 'LANCE PIC 9(5).',
      '*    na' + String.fromCodePoint(0xef) + 've comment about the caf' + String.fromCodePoint(0xe9),
      '    DISPLAY "Z' + String.fromCodePoint(0xfc) + 'rich"',
    ]);
    const found = findingsOf(scanCobol(source), 'ALZ-GEN-002');
    assert.equal(found.length, 1);
    assert.match(found[0].message, /U\+0410/);
    assert.equal(found[0].column, 12);
  });
});

describe('ALZ-GEN-003 secrets in source', () => {
  it('finds PEM private keys, AWS key ids, GitHub and Slack tokens', () => {
    const pem = `-----BEGIN RSA ${'PRIVATE'} KEY-----`;
    const aws = `AKIA${'IOSFODNN7EXAMPLE'}`;
    const github = `ghp_${'a'.repeat(36)}`;
    const slack = `xoxb-${'1234567890'}-abc`;
    const kinds = [pem, aws, github, slack].map((text) => findSecrets(`x ${text} y`).map((hit) => hit.kind));
    assert.deepEqual(kinds, [['PEM private key block'], ['AWS access key id'], ['GitHub token'], ['Slack token']]);
  });

  it('does not match look-alikes', () => {
    for (const text of ['AKIA1234', `XAKIA${'A'.repeat(16)}`, `AKIA${'A'.repeat(17)}`, `ghp_${'a'.repeat(35)}`, 'xoxq-1234567890',
      '-----BEGIN PUBLIC KEY-----', '-----BEGIN CERTIFICATE-----']) {
      assert.deepEqual(findSecrets(text), [], text);
    }
  });

  it('reports the finding with a redacted snippet', () => {
    const key = `AKIA${'IOSFODNN7EXAMPLE'}`;
    const [finding] = findingsOf(scanFortran(`! key ${key}\n`), 'ALZ-GEN-003');
    assert.equal(finding.column, 7);
    assert.equal(finding.endColumn, 27);
    assert.ok(!finding.snippet.includes(key));
    assert.ok(finding.snippet.includes('AKIA****'));
  });
});

describe('language detection', () => {
  it('uses the extension first, in any case', () => {
    for (const name of ['A.cob', 'b.CBL', 'c.cpy', 'D.Cobol']) assert.equal(detectLanguage(name, ''), 'cobol');
    for (const name of ['a.f90', 'B.F95', 'c.f03', 'd.f08', 'e.F18', 'f.f', 'g.FOR', 'h.ftn', 'i.f77']) {
      assert.equal(detectLanguage(name, ''), 'fortran');
    }
  });

  it('sniffs the content when the extension is unknown', () => {
    assert.equal(detectLanguage('input', '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. X.\n'), 'cobol');
    assert.equal(detectLanguage('input', '01  WS-A PIC X(10).\n'), 'cobol');
    assert.equal(detectLanguage('input', 'program x\n  implicit none\nend program x\n'), 'fortran');
    assert.equal(detectLanguage('input', 'just some notes\n'), 'unknown');
  });

  it('rejects invalid scan options', () => {
    assert.throws(() => scan('x', { language: 'pascal' }), TypeError);
    assert.throws(() => scan('x', { format: 'columnar' }), TypeError);
  });
});
