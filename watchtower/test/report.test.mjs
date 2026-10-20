import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RULES, VERSION, formatText, scan, summarize, toSarif } from '../src/index.mjs';
import { fnv1a64, lineHash, normalizeWhitespace } from '../src/report/hash.mjs';
import { displayWindow } from '../src/report/text.mjs';
import { cobolProgram, scanCobol } from './helpers.mjs';

const RLO = String.fromCodePoint(0x202e);

function sampleResults() {
  const cobol = scanCobol(cobolProgram({
    data: ['01  WS-PGM PIC X(8).', '01  WS-PAN PIC X(16).'],
    procedure: ['    CALL WS-PGM', '    DISPLAY WS-PAN *> watchtower-ignore ALZ-COB-005 -- masked test value'],
  }));
  const fortran = scan('program p\n  print *, 1.0 == 2.0\nend program p\n', { filename: 'dir with space/p.f90' });
  return [
    { file: 'src/Z.cbl', ...cobol },
    { file: 'dir with space/p.f90', ...fortran },
  ];
}

describe('FNV-1a 64-bit fingerprints', () => {
  it('matches the reference test vectors', () => {
    assert.equal(fnv1a64(''), 'cbf29ce484222325');
    assert.equal(fnv1a64('a'), 'af63dc4c8601ec8c');
    assert.equal(fnv1a64('foobar'), '85944171f73967e8');
  });

  it('ignores whitespace differences but not rule ids', () => {
    assert.equal(normalizeWhitespace('  MOVE   A\tTO  B  '), 'MOVE A TO B');
    assert.equal(lineHash('ALZ-COB-001', '   CALL  X'), lineHash('ALZ-COB-001', 'CALL X'));
    assert.notEqual(lineHash('ALZ-COB-001', 'CALL X'), lineHash('ALZ-COB-002', 'CALL X'));
    assert.match(lineHash('ALZ-COB-001', 'CALL X'), /^[0-9a-f]{16}$/);
  });
});

describe('SARIF 2.1.0', () => {
  const sarif = toSarif(sampleResults(), { srcRoot: '/home/ci/na' + String.fromCodePoint(0xef) + 've/alcazar' });
  const [run] = sarif.runs;

  it('has the schema, version and tool driver', () => {
    assert.equal(sarif.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
    assert.equal(sarif.version, '2.1.0');
    assert.equal(sarif.runs.length, 1);
    assert.equal(run.tool.driver.name, 'Watchtower');
    assert.equal(run.tool.driver.semanticVersion, VERSION);
    assert.equal(run.tool.driver.informationUri, 'https://github.com/Manuelma4/alcazar');
    assert.equal(run.tool.driver.rules.length, RULES.length);
  });

  it('describes every rule for GitHub code scanning', () => {
    for (const [index, rule] of run.tool.driver.rules.entries()) {
      assert.equal(rule.id, RULES[index].id);
      assert.match(rule.name, /^[A-Z][A-Za-z0-9]+$/);
      assert.ok(rule.shortDescription.text && rule.fullDescription.text && rule.help.text && rule.help.markdown);
      assert.equal(rule.helpUri, `https://github.com/Manuelma4/alcazar/blob/main/docs/rules/${rule.id}.md`);
      assert.ok(['error', 'warning', 'note'].includes(rule.defaultConfiguration.level));
      assert.equal(rule.properties.tags[0], 'security');
      assert.equal(rule.properties.tags[1], `external/cwe/cwe-${RULES[index].cwe.slice(4)}`);
      assert.ok(['high', 'medium', 'low'].includes(rule.properties.precision));
      assert.ok(['9.5', '8.0', '5.5', '3.0', '1.0'].includes(rule.properties['security-severity']));
    }
    const byId = Object.fromEntries(run.tool.driver.rules.map((r) => [r.id, r]));
    assert.equal(byId['ALZ-GEN-001'].properties['security-severity'], '9.5');
    assert.equal(byId['ALZ-COB-001'].defaultConfiguration.level, 'error');
    assert.equal(byId['ALZ-COB-005'].defaultConfiguration.level, 'warning');
    assert.equal(byId['ALZ-COB-008'].defaultConfiguration.level, 'note');
  });

  it('emits results with locations, fingerprints and in-source suppressions, ordered by file', () => {
    assert.deepEqual(run.results.map((r) => r.locations[0].physicalLocation.artifactLocation.uri),
      ['dir%20with%20space/p.f90', 'dir%20with%20space/p.f90', 'src/Z.cbl', 'src/Z.cbl']);
    const call = run.results.find((r) => r.ruleId === 'ALZ-COB-001');
    assert.equal(call.ruleIndex, RULES.findIndex((r) => r.id === 'ALZ-COB-001'));
    assert.equal(call.level, 'error');
    const location = call.locations[0].physicalLocation;
    assert.equal(location.artifactLocation.uriBaseId, '%SRCROOT%');
    assert.equal(location.region.startLine, 10);
    assert.equal(location.region.startColumn, 17);
    assert.equal(location.region.endColumn, 23);
    assert.equal(location.region.snippet.text, '           CALL WS-PGM');
    assert.match(call.partialFingerprints.primaryLocationLineHash, /^[0-9a-f]{16}$/);
    const suppressed = run.results.find((r) => r.ruleId === 'ALZ-COB-005');
    assert.deepEqual(suppressed.suppressions, [{ kind: 'inSource', justification: 'masked test value' }]);
    assert.equal(run.results.find((r) => r.ruleId === 'ALZ-FOR-005').level, 'note');
  });

  it('declares %SRCROOT% as a file URI when srcRoot is given', () => {
    assert.deepEqual(run.originalUriBaseIds, { '%SRCROOT%': { uri: 'file:///home/ci/na%C3%AFve/alcazar/' } });
    assert.equal(toSarif([]).runs[0].originalUriBaseIds, undefined);
    assert.equal(toSarif([], { srcRoot: 'C:\\work\\repo' }).runs[0].originalUriBaseIds['%SRCROOT%'].uri, 'file:///C:/work/repo/');
  });

  it('serialises to JSON deterministically', () => {
    assert.equal(JSON.stringify(toSarif(sampleResults())), JSON.stringify(toSarif(sampleResults().reverse())));
  });
});

describe('summary', () => {
  it('counts files, findings, suppressions, severities and rules', () => {
    const summary = summarize(sampleResults());
    assert.equal(summary.files, 2);
    assert.equal(summary.suppressed, 1);
    assert.equal(summary.findings, summary.bySeverity.critical + summary.bySeverity.high + summary.bySeverity.medium
      + summary.bySeverity.low + summary.bySeverity.info);
    assert.deepEqual(Object.keys(summary.bySeverity), ['critical', 'high', 'medium', 'low', 'info']);
    assert.equal(summary.byRule['ALZ-COB-001'], 1);
    assert.equal(summary.byRule['ALZ-COB-005'], undefined, 'suppressed findings are not counted');
    assert.deepEqual(Object.keys(summary.byRule), [...Object.keys(summary.byRule)].sort());
  });
});

describe('text report', () => {
  it('shows each finding with location, rule, CWE, source line, caret and fix', () => {
    const text = formatText(sampleResults(), { failOn: 'high' });
    assert.ok(text.startsWith(`Watchtower ${VERSION}`));
    assert.match(text, /src\/Z\.cbl:10:17/);
    assert.match(text, /ALZ-COB-001 {2}Dynamic CALL target from a data item {2}CWE-470/);
    assert.match(text, /10 │ {12}CALL WS-PGM\n\s+│ {17}\^{6}\n/);
    assert.match(text, /fix: /);
    assert.match(text, /✖ FAIL {2}1 unsuppressed finding at or above "high"/);
    assert.doesNotMatch(text, new RegExp(String.fromCharCode(27)), 'no ANSI codes without color');
  });

  it('uses ANSI colours only when asked', () => {
    assert.match(formatText(sampleResults(), { color: true }), new RegExp(`${String.fromCharCode(27)}\\[`));
  });

  it('reports PASS when nothing reaches the threshold', () => {
    assert.match(formatText(sampleResults(), { failOn: 'critical' }), /✔ PASS/);
    assert.match(formatText([], {}), /0 files · 0 findings/);
  });

  it('never prints bidi controls from the scanned source', () => {
    const result = scan(`program p ! ${RLO}x\nend program p\n`, { filename: 'p.f90' });
    const text = formatText([{ file: 'p.f90', ...result }]);
    assert.ok(!text.includes(RLO));
  });

  it('windows long lines around the finding', () => {
    const line = `${'x'.repeat(300)}TARGET${'y'.repeat(300)}`;
    const view = displayWindow(line, 301, 307);
    assert.ok(view.text.length <= 112);
    assert.equal(view.text.slice(view.caretStart, view.caretStart + view.caretLength), 'TARGET');
  });
});
