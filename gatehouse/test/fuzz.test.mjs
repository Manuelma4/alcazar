// SPDX-License-Identifier: Apache-2.0
// Fuzzing the HTTP surface: random JSON shapes, wrong types, raw bytes,
// odd content types and paths. Gatehouse must answer every request with a
// well-formed response and never with a 5xx — a 502 would mean some input
// crashed the legacy core, a 500 an unhandled error in Gatehouse.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { SKIP_REASON, VALID, startGatehouse } from './helpers.mjs';

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ['transactions', 'id', 'timestamp', 'from', 'to', 'amount', 'currency', 'pan', 'channel', 'memo',
  '__proto__', 'constructor', 'prototype', 'toString', '', ' ', 'TRANSACTIONS', 'amount ', 'x'];

function randomValue(rand, depth = 0) {
  const r = rand();
  if (depth > 3 || r < 0.25) {
    const s = rand();
    if (s < 0.2) return null;
    if (s < 0.35) return rand() < 0.5;
    if (s < 0.55) return [0, -1, 1e308, -0, 3.14, 2 ** 53 + 1, Number.MAX_SAFE_INTEGER][Math.floor(rand() * 7)];
    return Array.from({ length: Math.floor(rand() * 50) }, () => String.fromCodePoint(Math.floor(rand() * 0x2fff))).join('');
  }
  if (r < 0.6) return Array.from({ length: Math.floor(rand() * 6) }, () => randomValue(rand, depth + 1));
  const object = {};
  for (let i = Math.floor(rand() * 6); i > 0; i -= 1) {
    Object.defineProperty(object, KEYS[Math.floor(rand() * KEYS.length)], {
      value: randomValue(rand, depth + 1), enumerable: true, configurable: true, writable: true,
    });
  }
  return object;
}

/** A batch close to valid, with one field replaced by a random value. */
function nearlyValid(rand) {
  const txn = { ...VALID };
  const key = KEYS[1 + Math.floor(rand() * 9)];
  Object.defineProperty(txn, key, { value: randomValue(rand, 2), enumerable: true, configurable: true, writable: true });
  return { transactions: [txn] };
}

const ALLOWED = new Set([200, 400, 404, 405, 413, 414, 415]);

describe('Gatehouse under fuzzing', { skip: SKIP_REASON }, () => {
  let gh;
  before(async () => {
    gh = await startGatehouse({ ALCAZAR_RATE_CAPACITY: '100000', ALCAZAR_RATE_REFILL: '100000' });
  });
  after(async () => {
    await gh.stop();
  });

  async function send(path, init) {
    const res = await fetch(gh.base + path, init);
    const text = await res.text();
    assert.ok(ALLOWED.has(res.status), `${init?.method ?? 'GET'} ${path} -> ${res.status} ${text.slice(0, 200)}`);
    assert.ok(res.headers.get('content-security-policy'), 'security headers missing');
    if (res.status >= 400) {
      const body = JSON.parse(text);
      assert.equal(body.error.layer, 'gatehouse');
      assert.match(body.error.code, /^P-[A-Z]+$/);
    }
    return { status: res.status, text };
  }

  it('answers 300 random JSON bodies without a server error', async () => {
    const rand = prng(7);
    for (let i = 0; i < 300; i += 1) {
      const body = rand() < 0.5 ? randomValue(rand) : nearlyValid(rand);
      const { status, text } = await send('/api/batch', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (status === 200) assert.equal(JSON.parse(text).summary.received, body.transactions.length);
    }
  });

  it('answers raw bytes, odd content types and odd paths', async () => {
    const rand = prng(8);
    const types = ['application/json', 'application/json; charset=utf-8', 'APPLICATION/JSON', 'application/json; charset=latin1',
      'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', '', 'application/json,text/html'];
    for (let i = 0; i < 150; i += 1) {
      const bytes = Buffer.from(Array.from({ length: Math.floor(rand() * 400) }, () => Math.floor(rand() * 256)));
      const type = types[Math.floor(rand() * types.length)];
      await send('/api/batch', { method: 'POST', headers: type ? { 'content-type': type } : {}, body: bytes });
    }
    const paths = ['/api', '/api/', '/api/jobs', '/api/jobs/', '/api/jobs/j-123', `/api/jobs/j-${'f'.repeat(24)}/verify`,
      '/api/batch?x=1', '/api/sample?size=-1', '/api/sample?seed=99999999999', '/api/../api/health', '/%00', '/index.html%00',
      '/api/health/', '/API/HEALTH', `/${'a'.repeat(600)}`, '/shared/../package.json', '/watchtower/src/../../package.json'];
    for (const path of paths) await send(path, {});
    for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS']) await send('/api/batch', { method });
  });

  it('is still healthy afterwards', async () => {
    const health = await (await fetch(`${gh.base}/api/health`)).json();
    assert.equal(health.status, 'ok');
  });
});
