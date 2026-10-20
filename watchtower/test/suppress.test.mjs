import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseSuppression } from '../src/suppress.mjs';
import { cobolProgram, findingsOf, scanCobol, scanFortran } from './helpers.mjs';

const DATA = ['01  WS-PAN PIC X(16).'];

describe('suppression parsing', () => {
  it('reads ids and the justification', () => {
    const parsed = parseSuppression(' watchtower-ignore ALZ-COB-005, alz-cob-006 -- masked upstream');
    assert.deepEqual([...parsed.ids], ['ALZ-COB-005', 'ALZ-COB-006']);
    assert.equal(parsed.justification, 'masked upstream');
    assert.equal(parsed.valid, true);
  });

  it('is invalid without a reason or without known ids', () => {
    assert.equal(parseSuppression('watchtower-ignore ALZ-COB-005').valid, false);
    assert.equal(parseSuppression('watchtower-ignore ALZ-COB-005 --   ').valid, false);
    assert.equal(parseSuppression('watchtower-ignore ALZ-XXX-999 -- why').valid, false);
    assert.equal(parseSuppression('watchtower-ignored ALZ-COB-005 -- why'), null);
    assert.equal(parseSuppression('just a comment'), null);
  });
});

describe('COBOL suppressions', () => {
  it('applies a trailing *> comment to its own line', () => {
    const result = scanCobol(cobolProgram({ data: DATA, procedure: ['    DISPLAY WS-PAN *> watchtower-ignore ALZ-COB-005 -- test fixture value'] }));
    assert.equal(findingsOf(result, 'ALZ-COB-005').length, 0);
    assert.equal(result.suppressed.length, 1);
    assert.deepEqual(result.suppressed[0].suppression, { justification: 'test fixture value' });
  });

  it('applies a column-7 comment line to the next code line, skipping blank and comment lines', () => {
    const result = scanCobol(cobolProgram({
      data: DATA,
      procedure: ['* watchtower-ignore ALZ-COB-005 -- PAN is a test number', '', '*   another comment', '    DISPLAY WS-PAN', '    DISPLAY WS-PAN'],
    }));
    assert.equal(result.suppressed.length, 1);
    assert.equal(findingsOf(result, 'ALZ-COB-005').length, 1, 'only the first DISPLAY is suppressed');
  });

  it('does not apply a suppression without a reason, and says so', () => {
    const result = scanCobol(cobolProgram({ data: DATA, procedure: ['* watchtower-ignore ALZ-COB-005', '    DISPLAY WS-PAN'] }));
    const [finding] = findingsOf(result, 'ALZ-COB-005');
    assert.ok(finding);
    assert.match(finding.message, /has no "-- reason"/);
    assert.equal(result.suppressed.length, 0);
  });

  it('does not suppress other rules', () => {
    const result = scanCobol(cobolProgram({ data: DATA, procedure: ['    DISPLAY WS-PAN *> watchtower-ignore ALZ-COB-001 -- wrong rule'] }));
    assert.equal(findingsOf(result, 'ALZ-COB-005').length, 1);
  });
});

describe('Fortran suppressions', () => {
  it('supports trailing and standalone ! comments with several ids', () => {
    const source = [
      'subroutine c_api(buf, n) bind(c)', '  implicit none', '  integer, value :: n',
      '  ! watchtower-ignore ALZ-FOR-002 -- n is validated against the buffer size by the caller',
      '  integer(1), intent(in) :: buf(*)', '  integer :: u', "  open (newunit=u, file='x') ! watchtower-ignore ALZ-FOR-006, ALZ-FOR-001 -- demo",
      'end subroutine c_api',
    ].join('\n');
    const result = scanFortran(source);
    assert.deepEqual(result.suppressed.map((f) => f.ruleId).sort(), ['ALZ-FOR-002', 'ALZ-FOR-006']);
    assert.equal(result.findings.length, 0);
  });
});
