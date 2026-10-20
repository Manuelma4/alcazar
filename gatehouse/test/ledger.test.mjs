// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  deriveKeys, genesisMac, keyLines, recordMac, tamperLedger, tamperRecord, trimRecords, verifyLedger,
} from '../src/ledger.mjs';
import { LEDGER_LENGTH, LEDGER_MAC_INPUT } from '../src/records.mjs';

const master = Buffer.alloc(32, 0xa1);
const { ledger: key } = deriveKeys(master);
const JOB = 'j-test';

const token = (n) => createHmac('sha256', 'token').update(String(n)).digest('hex').slice(0, 16);

/** Build a ledger and its ACCEPTED / REJECTED records exactly as TXNGUARD writes them (format v2). */
function buildLedger(count) {
  let prev = genesisMac(key, JOB);
  const lines = [];
  const accepted = [];
  const rejected = [];
  for (let seq = 1; seq <= count; seq += 1) {
    const isAccepted = seq % 3 !== 0;
    const id = `T-${seq}`.padEnd(12);
    const record = isAccepted
      ? [id, '20251020101500', token(seq), token(seq + 100), 'FR76*******************0189'.padEnd(34),
        'DE89**************3000'.padEnd(34), String(seq * 100).padStart(15, '0'), 'EUR', 'WEB', ' '.repeat(19), 'Invoice'.padEnd(40)].join('')
      : [String(seq).padStart(6, '0'), id, 'E602', 'CARD-PAN'.padEnd(12), 'LUHN'.padEnd(30)].join('');
    (isAccepted ? accepted : rejected).push(`${record}\n`);
    const payload = [String(seq).padStart(6, '0'), isAccepted ? 'A' : 'R', id, '20251020101500', isAccepted ? 'A000' : 'E602',
      `+${String(seq * 100).padStart(15, '0')}`, 'EUR', 'FR76*******************0189'.padEnd(34), ' '.repeat(19),
      recordMac(key, record).toString('hex'), prev].join('|');
    const mac = createHmac('sha256', key).update(payload, 'latin1').digest('hex');
    lines.push(`${payload}|${mac}\n`);
    prev = mac;
  }
  return { text: lines.join(''), head: prev, records: { accepted: accepted.join(''), rejected: rejected.join('') } };
}

describe('Node / OpenSSL ledger verification', () => {
  it('derives sub-keys with key separation', () => {
    const keys = deriveKeys(master);
    assert.notDeepEqual(keys.ledger, keys.token);
    assert.equal(keys.ledger.length, 32);
  });

  it('encodes the sub-keys for stdin without a hex string', () => {
    const keys = deriveKeys(master);
    const lines = keyLines(keys.ledger, keys.token);
    assert.ok(Buffer.isBuffer(lines));
    assert.equal(lines.toString('latin1'), `${keys.ledger.toString('hex')}\n${keys.token.toString('hex')}\n`);
    assert.equal(keyLines(Buffer.from([0x00, 0x0f, 0xf0, 0xff])).toString('latin1'), '000ff0ff\n');
  });

  it('builds test ledgers in the v2 layout', () => {
    const { text } = buildLedger(1);
    assert.equal(text.length, LEDGER_LENGTH + 1);
    assert.equal(text.lastIndexOf('|'), LEDGER_MAC_INPUT);
  });

  it('accepts an intact ledger and its records, and returns the head', () => {
    const { text, head, records } = buildLedger(5);
    assert.deepEqual(verifyLedger(text, key, JOB, records), { valid: true, entries: 5, head, brokenAt: null, reason: null });
  });

  it('accepts an empty ledger (head = genesis)', () => {
    assert.equal(verifyLedger('', key, JOB).head, genesisMac(key, JOB));
  });

  it('detects an edited amount (MAC-MISMATCH)', () => {
    const { text, records } = buildLedger(4);
    assert.deepEqual(verifyLedger(tamperLedger(text, 2, 'amount').text, key, JOB, records),
      { valid: false, entries: 1, head: null, brokenAt: 2, reason: 'MAC-MISMATCH' });
  });

  it('detects a deleted entry (SEQ-GAP)', () => {
    const { text, records } = buildLedger(4);
    assert.equal(verifyLedger(tamperLedger(text, 2, 'delete').text, key, JOB, records).reason, 'SEQ-GAP');
  });

  it('cannot see a careful truncation on its own: the rest is a valid, shorter ledger', () => {
    const { text, records } = buildLedger(4);
    const cut = tamperLedger(text, 3, 'truncate').text;
    const result = verifyLedger(cut, key, JOB, trimRecords(cut, records));
    assert.equal(result.valid, true);
    assert.equal(result.entries, 2);
  });

  it('sees a truncation that leaves the records behind (RECORD-MISMATCH)', () => {
    const { text, records } = buildLedger(4);
    assert.deepEqual(verifyLedger(tamperLedger(text, 3, 'truncate').text, key, JOB, records),
      { valid: false, entries: 2, head: null, brokenAt: 3, reason: 'RECORD-MISMATCH' });
  });

  it('detects an edited decision record behind an intact chain (RECORD-MISMATCH)', () => {
    const { text, records } = buildLedger(6);
    const redirected = tamperRecord(text, records, 2);
    assert.equal(redirected.file, 'ACCEPTED.DAT');
    assert.notEqual(redirected.after.slice(42, 58), redirected.before.slice(42, 58));
    assert.deepEqual(verifyLedger(text, key, JOB, { ...records, accepted: redirected.text }),
      { valid: false, entries: 1, head: null, brokenAt: 2, reason: 'RECORD-MISMATCH' });
    const recoded = tamperRecord(text, records, 3);
    assert.equal(recoded.file, 'REJECTED.DAT');
    assert.equal(recoded.after.slice(18, 22), 'E101');
    assert.equal(verifyLedger(text, key, JOB, { ...records, rejected: recoded.text }).brokenAt, 3);
  });

  it('detects records added, removed or reordered (RECORD-MISMATCH)', () => {
    const { text, records } = buildLedger(6);
    const rows = records.accepted.match(/[^\n]*\n/g);
    const check = (accepted) => verifyLedger(text, key, JOB, { ...records, accepted });
    assert.deepEqual([check(records.accepted + rows[0]).brokenAt, check(records.accepted + rows[0]).reason], [7, 'RECORD-MISMATCH']);
    assert.equal(check(rows.slice(1).join('')).brokenAt, 1);
    assert.equal(check([rows[1], rows[0], ...rows.slice(2)].join('')).brokenAt, 1);
    assert.equal(check('').reason, 'RECORD-MISMATCH');
  });

  it('reads fixed-length records: no final newline or a CR is a FORMAT break', () => {
    const { text, records } = buildLedger(3);
    assert.deepEqual(verifyLedger(text.slice(0, -1), key, JOB, records),
      { valid: false, entries: 2, head: null, brokenAt: 3, reason: 'FORMAT' });
    assert.equal(verifyLedger(text.replace('\n', '\r\n'), key, JOB, records).brokenAt, 1);
    const accepted = records.accepted.replace(/\n$/, '');
    assert.equal(verifyLedger(text, key, JOB, { ...records, accepted }).reason, 'RECORD-MISMATCH');
  });

  it('detects a chain sealed for another job (CHAIN-BREAK)', () => {
    const { text, records } = buildLedger(2);
    assert.equal(verifyLedger(text, key, 'j-other', records).reason, 'CHAIN-BREAK');
  });

  it('detects a wrong key and malformed lines', () => {
    const { ledger: otherKey } = deriveKeys(Buffer.alloc(32, 0x01));
    const { text, records } = buildLedger(2);
    assert.equal(verifyLedger(text, otherKey, JOB, records).reason, 'CHAIN-BREAK');
    assert.equal(verifyLedger('garbage\n', key, JOB).reason, 'FORMAT');
  });

  it('refuses impossible tamper requests', () => {
    const { text, records } = buildLedger(2);
    assert.throws(() => tamperLedger(text, 3, 'amount'), RangeError);
    assert.throws(() => tamperLedger(text, 1, 'rewrite'), RangeError);
    assert.throws(() => tamperRecord(text, records, 3), RangeError);
    assert.throws(() => tamperRecord(text, { accepted: '', rejected: '' }, 1), RangeError);
  });
});
