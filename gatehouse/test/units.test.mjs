// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RateLimiter } from '../src/ratelimit.mjs';
import { luhnComplete, makeIban, sampleBatch } from '../src/sample.mjs';

function ibanValid(iban) {
  const digits = [...(iban.slice(4) + iban.slice(0, 4))].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
  return BigInt(digits) % 97n === 1n;
}

function luhnValid(pan) {
  let sum = 0;
  [...pan].reverse().forEach((c, i) => {
    let d = Number(c);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  });
  return sum % 10 === 0;
}

describe('sample generator', () => {
  it('is deterministic for a seed and honours the size', () => {
    assert.deepEqual(sampleBatch({ size: 120, seed: 7 }), sampleBatch({ size: 120, seed: 7 }));
    assert.notDeepEqual(sampleBatch({ size: 120, seed: 7 }), sampleBatch({ size: 120, seed: 8 }));
    for (const size of [1, 39, 40, 200, 1000]) assert.equal(sampleBatch({ size }).transactions.length, size);
  });

  it('builds IBANs with valid check digits and Luhn-valid cards', () => {
    assert.equal(makeIban('DE', '370400440532013000'), 'DE89370400440532013000');
    assert.ok(luhnValid(luhnComplete('411111111111111')));
  });

  it('plants exactly the anomalies the layers are expected to catch', () => {
    const { transactions } = sampleBatch({ size: 200, seed: 42 });
    const invalidIbans = transactions.filter((t) => !ibanValid(t.from) || !ibanValid(t.to));
    assert.equal(invalidIbans.length, 1);
    assert.ok(transactions.filter((t) => t.pan).every((t) => t.pan === '4111111111111112' || luhnValid(t.pan)));
    assert.equal(new Set(transactions.map((t) => t.id)).size, 199);
    assert.ok(transactions.some((t) => t.amount === '25000.00'));
  });
});

describe('rate limiter', () => {
  it('allows a burst, then refills over time', () => {
    let now = 0;
    const limiter = new RateLimiter({ capacity: 3, refillPerSecond: 1, now: () => now });
    for (let i = 0; i < 3; i += 1) assert.equal(limiter.take('a').allowed, true);
    const denied = limiter.take('a');
    assert.equal(denied.allowed, false);
    assert.equal(denied.retryAfterS, 1);
    assert.equal(limiter.take('b').allowed, true);
    now = 1000;
    assert.equal(limiter.take('a').allowed, true);
  });

  it('keeps a bounded number of clients', () => {
    const limiter = new RateLimiter({ capacity: 1, refillPerSecond: 1, maxClients: 2 });
    limiter.take('a');
    limiter.take('b');
    limiter.take('c');
    assert.equal(limiter.buckets.size, 2);
    assert.ok(!limiter.buckets.has('a'));
  });
});
