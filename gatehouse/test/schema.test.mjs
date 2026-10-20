// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../src/http.mjs';
import { validateBatch } from '../src/schema.mjs';
import { VALID } from './helpers.mjs';

const rejects = (body, code, field) => {
  assert.throws(() => validateBatch(body, 1000), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.code, code);
    if (field) assert.equal(error.extra.field, field);
    return true;
  });
};

describe('validateBatch', () => {
  it('accepts a valid batch and normalizes IBANs and card numbers', () => {
    const [txn] = validateBatch({ transactions: [{ ...VALID, to: 'de89 3704 0044 0532 0130 00', pan: '4111 1111 1111 1111' }] }, 1000);
    assert.equal(txn.from, 'FR7630006000011234567890189');
    assert.equal(txn.to, 'DE89370400440532013000');
    assert.equal(txn.pan, '4111111111111111');
  });

  it('fills optional fields with empty strings', () => {
    const { memo, ...rest } = VALID;
    const [txn] = validateBatch({ transactions: [rest] }, 1000);
    assert.equal(txn.memo, '');
    assert.equal(txn.pan, '');
  });

  it('returns objects without a prototype', () => {
    const [txn] = validateBatch({ transactions: [VALID] }, 1000);
    assert.equal(Object.getPrototypeOf(txn), null);
  });

  it('rejects unknown top-level keys, including __proto__', () => {
    rejects(JSON.parse('{"transactions":[],"__proto__":{"isAdmin":true}}'), 'P-SCHEMA', '__proto__');
    rejects({ transactions: [VALID], extra: 1 }, 'P-SCHEMA', 'extra');
  });

  it('rejects unknown transaction keys', () => {
    rejects({ transactions: [{ ...VALID, admin: 'yes' }] }, 'P-SCHEMA', 'transactions[0].admin');
    rejects({ transactions: [JSON.parse(`{"constructor":"x",${JSON.stringify(VALID).slice(1)}`)] }, 'P-SCHEMA');
  });

  it('rejects wrong types and missing fields', () => {
    rejects([], 'P-SCHEMA');
    rejects(null, 'P-SCHEMA');
    rejects({ transactions: {} }, 'P-SCHEMA', 'transactions');
    rejects({ transactions: [] }, 'P-SCHEMA', 'transactions');
    rejects({ transactions: [[]] }, 'P-SCHEMA', 'transactions[0]');
    rejects({ transactions: [{ ...VALID, amount: 125 }] }, 'P-SCHEMA', 'transactions[0].amount');
    const { amount, ...noAmount } = VALID;
    rejects({ transactions: [noAmount] }, 'P-SCHEMA', 'transactions[0].amount');
  });

  it('enforces the batch limit before looking at items', () => {
    rejects({ transactions: Array.from({ length: 1001 }, () => 'not even an object') }, 'P-LIMIT');
  });

  it('enforces field lengths, also after normalization', () => {
    rejects({ transactions: [{ ...VALID, memo: 'x'.repeat(41) }] }, 'P-LENGTH', 'transactions[0].memo');
    rejects({ transactions: [{ ...VALID, id: 'X'.repeat(13) }] }, 'P-LENGTH', 'transactions[0].id');
    rejects({ transactions: [{ ...VALID, from: 'FR76'.repeat(9) }] }, 'P-LENGTH', 'transactions[0].from');
  });

  it('rejects control and non-ASCII characters (record and log injection, Trojan Source)', () => {
    rejects({ transactions: [{ ...VALID, memo: 'ok\nT-9999' }] }, 'P-CHARSET', 'transactions[0].memo');
    rejects({ transactions: [{ ...VALID, memo: 'tab\there' }] }, 'P-CHARSET');
    rejects({ transactions: [{ ...VALID, memo: 'Refund \u{202E}etouq' }] }, 'P-CHARSET');
    rejects({ transactions: [{ ...VALID, memo: 'caf\u{E9}' }] }, 'P-CHARSET');
    rejects({ transactions: [{ ...VALID, id: 'T\u0000' }] }, 'P-CHARSET', 'transactions[0].id');
  });

  it('leaves business rules to TXNGUARD', () => {
    const [txn] = validateBatch({ transactions: [{ ...VALID, amount: '-500.00', currency: 'BTC', memo: '<b>' }] }, 1000);
    assert.equal(txn.amount, '-500.00');
    assert.equal(txn.currency, 'BTC');
  });
});
