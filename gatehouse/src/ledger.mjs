// SPDX-License-Identifier: Apache-2.0
// An independent, Node.js / OpenSSL implementation of the Seal ledger
// checks. Gatehouse verifies every ledger twice — with LEDGERCK (COBOL +
// the Fortran HMAC kernel) and here — and the two must agree.

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ACCEPTED_LENGTH, LEDGER_LENGTH, LEDGER_MAC_INPUT, REJECTED_LENGTH, RecordError, fixedRecords, parseLedgerLine,
} from './records.mjs';

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
  return createHmac('sha256', ledgerKey).update(`alcazar/genesis/v2|${jobId}`, 'latin1').digest('hex');
}

/** The MAC an entry seals of its ACCEPTED or REJECTED record. */
export function recordMac(ledgerKey, record) {
  return createHmac('sha256', ledgerKey).update(`alcazar/record|${record}`, 'latin1').digest();
}

/**
 * Same checks, in the same order, as LEDGERCK — on the same fixed-length
 * records, so the two verifiers see the same bytes.
 * @param {{ accepted?: string, rejected?: string }} records  ACCEPTED.DAT and REJECTED.DAT
 * @returns {{ valid: boolean, entries: number, head: string | null, brokenAt: number | null, reason: string | null }}
 */
export function verifyLedger(text, ledgerKey, jobId, { accepted = '', rejected = '' } = {}) {
  let prev = genesisMac(ledgerKey, jobId);
  const records = { A: fixedRecords(accepted, ACCEPTED_LENGTH), R: fixedRecords(rejected, REJECTED_LENGTH) };
  const used = { A: 0, R: 0 };
  let verified = 0;
  const broken = (reason) => ({ valid: false, entries: verified, head: null, brokenAt: verified + 1, reason });
  for (const { data, complete } of fixedRecords(text, LEDGER_LENGTH)) {
    let entry;
    try {
      if (!complete) throw new RecordError('short or unterminated ledger record');
      entry = parseLedgerLine(data);
    } catch (error) {
      if (error instanceof RecordError) return broken('FORMAT');
      throw error;
    }
    if (entry.seq !== verified + 1) return broken('SEQ-GAP');
    if (entry.prev !== prev) return broken('CHAIN-BREAK');
    const mac = createHmac('sha256', ledgerKey).update(data.slice(0, LEDGER_MAC_INPUT), 'latin1').digest();
    if (!timingSafeEqual(mac, Buffer.from(entry.mac, 'hex'))) return broken('MAC-MISMATCH');
    // The entry is authentic; the next record of its type must be too.
    const record = records[entry.type][used[entry.type]];
    used[entry.type] += 1;
    if (!record?.complete || !timingSafeEqual(recordMac(ledgerKey, record.data), Buffer.from(entry.recordMac, 'hex'))) {
      return broken('RECORD-MISMATCH');
    }
    prev = entry.mac;
    verified += 1;
  }
  // A record that no entry seals was added after the fact.
  if (used.A < records.A.length || used.R < records.R.length) return broken('RECORD-MISMATCH');
  return { valid: true, entries: verified, head: prev, brokenAt: null, reason: null };
}

function ledgerRows(text) {
  return fixedRecords(text, LEDGER_LENGTH).map((record) => record.data);
}

function joinRows(rows) {
  return rows.map((row) => `${row}\n`).join('');
}

/**
 * Demo only (Siege lab): simulate an insider editing the ledger file.
 * @param {'amount' | 'delete' | 'truncate'} mode
 */
export function tamperLedger(text, seq, mode) {
  const rows = ledgerRows(text);
  if (!Number.isInteger(seq) || seq < 1 || seq > rows.length) throw new RangeError('no such ledger entry');
  const index = seq - 1;
  const before = rows[index];
  let after = null;
  if (mode === 'amount') {
    // Add 1,000.00 to the amount, keeping the old MAC.
    const cents = BigInt(before.slice(43, 58)) + 100000n;
    after = before.slice(0, 43) + String(cents).padStart(15, '0').slice(-15) + before.slice(58);
    if (after.length !== LEDGER_LENGTH) throw new Error('tamper produced a malformed line');
    rows[index] = after;
  } else if (mode === 'delete') {
    rows.splice(index, 1);
  } else if (mode === 'truncate') {
    rows.length = index;
  } else {
    throw new RangeError('unknown tamper mode');
  }
  return { text: joinRows(rows), before, after };
}

/**
 * Demo only: cut the ACCEPTED / REJECTED records that no longer have a
 * ledger entry — a careful insider truncates all three files together.
 * @param {string} ledgerText  the (truncated) ledger
 * @param {{ accepted: string, rejected: string }} records
 */
export function trimRecords(ledgerText, records) {
  const rows = ledgerRows(ledgerText);
  const keep = (text, length, type) => joinRows(fixedRecords(text, length).map((r) => r.data)
    .slice(0, rows.filter((row) => row[7] === type).length));
  return { accepted: keep(records.accepted, ACCEPTED_LENGTH, 'A'), rejected: keep(records.rejected, REJECTED_LENGTH, 'R') };
}

/**
 * Demo only (Siege lab): an insider rewrites the decision record behind
 * ledger line `seq` and leaves the ledger alone. An accepted transfer is
 * redirected to another beneficiary of the batch (or back to the sender);
 * a rejection gets a different reason code.
 * @param {string} ledgerText
 * @param {{ accepted: string, rejected: string }} records
 * @returns {{ file: 'ACCEPTED.DAT' | 'REJECTED.DAT', text: string, before: string, after: string }}
 */
export function tamperRecord(ledgerText, records, seq) {
  const rows = ledgerRows(ledgerText);
  if (!Number.isInteger(seq) || seq < 1 || seq > rows.length) throw new RangeError('no such ledger entry');
  const type = rows[seq - 1][7];
  const index = rows.slice(0, seq - 1).filter((row) => row[7] === type).length;
  const accepted = type === 'A';
  const list = fixedRecords(accepted ? records.accepted : records.rejected, accepted ? ACCEPTED_LENGTH : REJECTED_LENGTH)
    .map((record) => record.data);
  if (index >= list.length) throw new RangeError('no record behind this ledger entry');
  const before = list[index];
  let after;
  if (accepted) {
    // TO-TOKEN (42, 16) and TO-MASKED (92, 34): an account the insider
    // can name without the token key — one that already appears.
    const toToken = (r) => r.slice(42, 58);
    const other = list.find((r) => toToken(r) !== toToken(before) && toToken(r) !== before.slice(26, 42));
    const [token, masked] = other ? [other.slice(42, 58), other.slice(92, 126)] : [before.slice(26, 42), before.slice(58, 92)];
    after = before.slice(0, 42) + token + before.slice(58, 92) + masked + before.slice(126);
  } else {
    // CODE (18, 4).
    after = before.slice(0, 18) + (before.slice(18, 22) === 'E101' ? 'E201' : 'E101') + before.slice(22);
  }
  if (after.length !== before.length) throw new Error('tamper produced a malformed record');
  list[index] = after;
  return { file: accepted ? 'ACCEPTED.DAT' : 'REJECTED.DAT', text: joinRows(list), before, after };
}
