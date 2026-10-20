// SPDX-License-Identifier: Apache-2.0
// An independent, Node.js / OpenSSL implementation of the Seal ledger
// checks. Gatehouse verifies every ledger twice — with LEDGERCK (COBOL +
// the Fortran HMAC kernel) and here — and the two must agree.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { LEDGER_LENGTH, LEDGER_MAC_INPUT, RecordError, parseLedgerLine } from './records.mjs';

/** Sub-keys exactly as ALZKEYP derives them: HMAC(master, label || 0x01). */
export function deriveKeys(masterKey) {
  const derive = (label) => createHmac('sha256', masterKey).update(Buffer.from(`${label}\x01`, 'latin1')).digest();
  return { ledger: derive('alcazar/ledger/v1'), token: derive('alcazar/token/v1') };
}

const HEX_DIGITS = Buffer.from('0123456789abcdef', 'latin1');

/**
 * The stdin a legacy program reads its keys from: one line of lower-case
 * hex per key. Encoded straight into a Buffer — a hex string could never
 * be wiped.
 */
export function keyLines(...keys) {
  const out = Buffer.alloc(keys.reduce((n, key) => n + key.length * 2 + 1, 0));
  let at = 0;
  for (const key of keys) {
    for (const byte of key) {
      out[at++] = HEX_DIGITS[byte >> 4];
      out[at++] = HEX_DIGITS[byte & 15];
    }
    out[at++] = 0x0a;
  }
  return out;
}

export function genesisMac(ledgerKey, jobId) {
  return createHmac('sha256', ledgerKey).update(`alcazar/genesis|${jobId}`, 'latin1').digest('hex');
}

/**
 * Same checks, in the same order, as LEDGERCK.
 * @returns {{ valid: boolean, entries: number, head: string | null, brokenAt: number | null, reason: string | null }}
 */
export function verifyLedger(text, ledgerKey, jobId) {
  let prev = genesisMac(ledgerKey, jobId);
  const rows = text === '' ? [] : text.replace(/\n$/, '').split('\n');
  let verified = 0;
  for (const raw of rows) {
    const expected = verified + 1;
    const broken = (reason) => ({ valid: false, entries: verified, head: null, brokenAt: expected, reason });
    let entry;
    try {
      entry = parseLedgerLine(raw);
    } catch (error) {
      if (error instanceof RecordError) return broken('FORMAT');
      throw error;
    }
    if (entry.seq !== expected) return broken('SEQ-GAP');
    if (entry.prev !== prev) return broken('CHAIN-BREAK');
    const mac = createHmac('sha256', ledgerKey).update(raw.slice(0, LEDGER_MAC_INPUT), 'latin1').digest();
    if (!timingSafeEqual(mac, Buffer.from(entry.mac, 'hex'))) return broken('MAC-MISMATCH');
    prev = entry.mac;
    verified += 1;
  }
  return { valid: true, entries: verified, head: prev, brokenAt: null, reason: null };
}

/**
 * Demo only (Siege lab): simulate an insider editing the ledger file.
 * @param {'amount' | 'delete' | 'truncate'} mode
 */
export function tamperLedger(text, seq, mode) {
  const rows = text === '' ? [] : text.replace(/\n$/, '').split('\n');
  if (!Number.isInteger(seq) || seq < 1 || seq > rows.length) throw new RangeError('no such ledger entry');
  const index = seq - 1;
  const before = rows[index];
  let after = null;
  if (mode === 'amount') {
    // Add 1,000.00 to the amount, keeping the old MAC.
    const cents = BigInt(before.slice(42, 57)) + 100000n;
    after = before.slice(0, 42) + String(cents).padStart(15, '0').slice(-15) + before.slice(57);
    if (after.length !== LEDGER_LENGTH) throw new Error('tamper produced a malformed line');
    rows[index] = after;
  } else if (mode === 'delete') {
    rows.splice(index, 1);
  } else if (mode === 'truncate') {
    rows.length = index;
  } else {
    throw new RangeError('unknown tamper mode');
  }
  return { text: rows.length ? `${rows.join('\n')}\n` : '', before, after };
}
