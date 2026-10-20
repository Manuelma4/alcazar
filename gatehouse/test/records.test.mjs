// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RecordError, parseAccepted, parseLedgerck, parseRejected, parseRisk, parseSummary, txnInLines, txnInRecord,
} from '../src/records.mjs';

const TXN = {
  id: 'T-0001', timestamp: '20251020101500', from: 'FR7630006000011234567890189', to: 'DE89370400440532013000',
  amount: '125.00', currency: 'EUR', pan: '4111111111111111', channel: 'POS', memo: 'Groceries',
};

describe('TXNIN records', () => {
  it('pads every field to its column', () => {
    const record = txnInRecord(TXN);
    assert.equal(record.length, 200);
    assert.equal(record.slice(0, 12), 'T-0001      ');
    assert.equal(record.slice(26, 60).trimEnd(), TXN.from);
    assert.equal(record.slice(94, 112), '125.00            ');
    assert.equal(record.slice(115, 134).trimEnd(), TXN.pan);
    assert.equal(record.slice(137, 177).trimEnd(), 'Groceries');
  });

  it('sends one 200-byte record per line', () => {
    const lines = txnInLines([TXN, TXN]);
    assert.equal(lines.length, 402);
    assert.deepEqual([lines[200], lines[401]], [0x0a, 0x0a]);
    assert.equal(lines.indexOf(0x0a), 200);
  });

  it('refuses a field that does not fit or is not printable', () => {
    assert.throws(() => txnInRecord({ ...TXN, memo: 'x'.repeat(41) }));
    assert.throws(() => txnInRecord({ ...TXN, memo: 'a\nb' }));
  });
});

describe('legacy output parsers', () => {
  it('parses fixed-length ACCEPTED records', () => {
    const line = 'TX-0015     20251020102900' + '23183b3f60a528b1' + '8916d2ad45793711' +
      'ES91****************1332'.padEnd(34) + 'DE89**************3000'.padEnd(34) + '000000004800000EURMOB';
    const [txn] = parseAccepted(`${line.padEnd(206)}\n`);
    assert.equal(txn.amountCents, '4800000');
    assert.equal(txn.panMasked, null);
    assert.equal(txn.memo, '');
  });

  it('rejects malformed ACCEPTED data, trimmed records included', () => {
    const line = 'TX-0015     20251020102900' + '23183b3f60a528b1' + '8916d2ad45793711' +
      'ES91****************1332'.padEnd(34) + 'DE89**************3000'.padEnd(34) + '000000004800000EURMOB';
    assert.throws(() => parseAccepted(`${line}\n`), RecordError);
    assert.throws(() => parseAccepted('short\n'), RecordError);
    assert.throws(() => parseAccepted(line.padEnd(206)), RecordError);
  });

  it('parses fixed-length REJECTED records', () => {
    const [r] = parseRejected(`${'000013A??? -?? ?  E101TXN-ID      POS=002'.padEnd(64)}\n`);
    assert.deepEqual(r, { line: 13, legacyId: 'A??? -?? ?', code: 'E101', field: 'TXN-ID', detail: 'POS=002' });
    assert.throws(() => parseRejected('000013A??? -?? ?  E101TXN-ID      POS=002\n'), RecordError);
  });

  it('parses SUMMARY files and their per-currency totals', () => {
    const head = 'a'.repeat(64);
    const s = parseSummary(`ALZ-SUMMARY=1\nJOB=j-1\nRECORDS=2\nACCEPTED=1\nREJECTED=1\nTOTAL-EUR=12500\nLEDGER-ENTRIES=2\nLEDGER-HEAD=${head}\nSELFTEST=PASS\nRC=4\n`);
    assert.equal(s.records, 2);
    assert.deepEqual({ ...s.totalsByCurrency }, { EUR: '12500' });
    assert.equal(s.ledgerHead, head);
    assert.throws(() => parseSummary('RECORDS=2\n'), RecordError);
  });

  it('parses both LEDGERCK verdicts and nothing else', () => {
    const head = 'b'.repeat(64);
    assert.deepEqual(parseLedgerck(`ALZ-LEDGER|STATUS=OK|ENTRIES=000004|HEAD=${head}\n`),
      { valid: true, entries: 4, head, brokenAt: null, reason: null });
    assert.deepEqual(parseLedgerck('ALZ-LEDGER|STATUS=BROKEN|ENTRIES=000001|SEQ=000002|REASON=MAC-MISMATCH\n'),
      { valid: false, entries: 1, head: null, brokenAt: 2, reason: 'MAC-MISMATCH' });
    assert.throws(() => parseLedgerck('ALZ-LEDGER|STATUS=OK'), RecordError);
  });

  it('validates RISK.JSON against the contract', () => {
    const risk = {
      schema: 'alcazar.fraudscan/v1', n: 1,
      benford: { n: 1, counts: [1, 0, 0, 0, 0, 0, 0, 0, 0], observed: [1, 0, 0, 0, 0, 0, 0, 0, 0], expected: Array(9).fill(0.1),
        chi2: 2.3, pValue: 0.97, mad: 0.1, verdict: 'insufficient', verdictBasis: 'none' },
      amounts: { medianCents: 100, madCents: 0, minCents: 100, maxCents: 100, histogram: { log10Edges: [0, 0.25], counts: [1] } },
      thresholds: { z: 3.5, zScaleFloor: 0.25, structuring: [{ currency: 'EUR', lowCents: 900000, highCents: 1000000 }], velocityCount: 5,
        velocityWindowS: 600, entropyBits: 4, entropyMinLength: 20 },
      transactions: [{ id: 'T-1', score: 0, z: null, entropy: 2.5, signals: [] }],
      flagged: 0,
    };
    assert.equal(parseRisk(JSON.stringify(risk)).transactions[0].id, 'T-1');
    assert.throws(() => parseRisk(JSON.stringify({ ...risk, schema: 'other' })), RecordError);
    assert.throws(() => parseRisk(JSON.stringify({ ...risk, transactions: [{ ...risk.transactions[0], signals: ['EVIL'] }] })), RecordError);
    assert.throws(() => parseRisk(JSON.stringify({ ...risk, transactions: [{ ...risk.transactions[0], id: '<script>' }] })), RecordError);
    assert.throws(() => parseRisk('{'), RecordError);
    assert.deepEqual(parseRisk(JSON.stringify(risk)).thresholds.structuring, [{ currency: 'EUR', lowCents: 900000, highCents: 1000000 }]);
    const band = (s) => JSON.stringify({ ...risk, thresholds: { ...risk.thresholds, structuring: s } });
    assert.throws(() => parseRisk(band([{ currency: 'eur', lowCents: 1, highCents: 2 }])), RecordError);
    assert.throws(() => parseRisk(band([{ currency: 'EUR', lowCents: 2, highCents: 1 }])), RecordError);
    assert.throws(() => parseRisk(band({ EUR: [1, 2] })), RecordError);
  });
});
