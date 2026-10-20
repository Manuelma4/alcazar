// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { deriveKeys, genesisMac, keyLines, tamperLedger, verifyLedger } from '../src/ledger.mjs';

const master = Buffer.alloc(32, 0xa1);
const { ledger: key } = deriveKeys(master);
const JOB = 'j-test';

/** Build a ledger exactly as TXNGUARD writes it. */
function buildLedger(count) {
  let prev = genesisMac(key, JOB);
  const lines = [];
  for (let seq = 1; seq <= count; seq += 1) {
    const payload = [String(seq).padStart(6, '0'), 'A', `T-${seq}`.padEnd(12), '20251020101500', 'A000',
      String(seq * 100).padStart(15, '0'), 'EUR', 'FR76*******************0189'.padEnd(34), ' '.repeat(19), prev].join('|');
    const mac = createHmac('sha256', key).update(payload, 'latin1').digest('hex');
    lines.push(`${payload}|${mac}`);
    prev = mac;
  }
  return { text: `${lines.join('\n')}\n`, head: prev };
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

  it('accepts an intact chain and returns its head', () => {
    const { text, head } = buildLedger(5);
    assert.deepEqual(verifyLedger(text, key, JOB), { valid: true, entries: 5, head, brokenAt: null, reason: null });
  });

  it('accepts an empty ledger (head = genesis)', () => {
    assert.equal(verifyLedger('', key, JOB).head, genesisMac(key, JOB));
  });

  it('detects an edited amount (MAC-MISMATCH)', () => {
    const { text } = tamperLedger(buildLedger(4).text, 2, 'amount');
    assert.deepEqual(verifyLedger(text, key, JOB), { valid: false, entries: 1, head: null, brokenAt: 2, reason: 'MAC-MISMATCH' });
  });

  it('detects a deleted entry (SEQ-GAP)', () => {
    const { text } = tamperLedger(buildLedger(4).text, 2, 'delete');
    assert.equal(verifyLedger(text, key, JOB).reason, 'SEQ-GAP');
  });

  it('cannot see truncation on its own: the remaining chain is valid', () => {
    const { text } = tamperLedger(buildLedger(4).text, 3, 'truncate');
    const result = verifyLedger(text, key, JOB);
    assert.equal(result.valid, true);
    assert.equal(result.entries, 2);
  });

  it('detects a chain sealed for another job (CHAIN-BREAK)', () => {
    assert.equal(verifyLedger(buildLedger(2).text, key, 'j-other').reason, 'CHAIN-BREAK');
  });

  it('detects a wrong key and malformed lines', () => {
    const { ledger: otherKey } = deriveKeys(Buffer.alloc(32, 0x01));
    assert.equal(verifyLedger(buildLedger(2).text, otherKey, JOB).reason, 'CHAIN-BREAK');
    assert.equal(verifyLedger('garbage\n', key, JOB).reason, 'FORMAT');
  });

  it('refuses impossible tamper requests', () => {
    assert.throws(() => tamperLedger(buildLedger(2).text, 3, 'amount'), RangeError);
    assert.throws(() => tamperLedger(buildLedger(2).text, 1, 'rewrite'), RangeError);
  });
});
