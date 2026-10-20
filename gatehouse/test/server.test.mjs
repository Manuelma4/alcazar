// SPDX-License-Identifier: Apache-2.0
// Integration tests: a real Gatehouse running the real COBOL / Fortran
// binaries.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { CSP } from '../src/http.mjs';
import { SKIP_REASON, VALID, postJson, startGatehouse } from './helpers.mjs';

describe('Gatehouse', { skip: SKIP_REASON }, () => {
  let gh;
  before(async () => {
    gh = await startGatehouse();
  });
  after(async () => {
    await gh.stop();
  });

  it('passes its power-on self-test', async () => {
    const health = await (await fetch(`${gh.base}/api/health`)).json();
    assert.equal(health.status, 'ok');
    assert.equal(health.selftest.status, 'pass');
    const names = health.selftest.checks.map((c) => c.name);
    for (const name of ['sha256-fips180-4', 'hmac-sha256-rfc4231', 'ledger-cross-check-openssl', 'token-cross-check-openssl']) {
      assert.ok(names.includes(name), name);
    }
  });

  it('sends the security headers on every response', async () => {
    for (const path of ['/api/health', '/api/nope', '/nope']) {
      const res = await fetch(gh.base + path);
      assert.equal(res.headers.get('content-security-policy'), CSP, path);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin');
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(res.headers.get('x-powered-by'), null);
      assert.equal(res.headers.get('server'), null);
    }
  });

  it('never maps a URL to the filesystem', async () => {
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/assets/..%2f..%2fpackage.json', '/build/bin/txnguard', '/gatehouse/src/app.mjs']) {
      const res = await fetch(gh.base + path);
      assert.equal(res.status, 404, path);
      assert.equal((await res.json()).error.code, 'P-NOTFOUND');
    }
  });

  it('serves the shared Siege module with a validator', async () => {
    const res = await fetch(`${gh.base}/shared/lab.mjs`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/javascript/);
    const again = await fetch(`${gh.base}/shared/lab.mjs`, { headers: { 'if-none-match': res.headers.get('etag') } });
    assert.equal(again.status, 304);
  });

  it('rejects other hosts (DNS rebinding)', async () => {
    const { request } = await import('node:http');
    const status = await new Promise((resolve, reject) => {
      const url = new URL(`${gh.base}/api/health`);
      request({ host: url.hostname, port: url.port, path: url.pathname, headers: { host: 'evil.example:80' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject).end();
    });
    assert.equal(status, 421);
  });

  it('refuses cross-site and non-JSON requests', async () => {
    let res = await postJson(gh.base, '/api/batch', { transactions: [VALID] }, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    res = await postJson(gh.base, '/api/batch', { transactions: [VALID] }, { 'sec-fetch-site': 'cross-site' });
    assert.equal(res.status, 403);
    res = await fetch(`${gh.base}/api/batch`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    assert.equal(res.status, 415);
    res = await fetch(`${gh.base}/api/batch`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 405);
  });

  it('bounds the body size and rejects malformed JSON', async () => {
    let res = await postJson(gh.base, '/api/batch', `{"transactions":["${'x'.repeat(600 * 1024)}"]}`);
    assert.equal(res.status, 413);
    res = await postJson(gh.base, '/api/batch', '{"transactions": [');
    assert.equal((await res.json()).error.code, 'P-JSON');
    res = await fetch(`${gh.base}/api/batch`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: Buffer.from([0x7b, 0xff, 0x7d]),
    });
    assert.equal((await res.json()).error.code, 'P-JSON');
  });

  it('runs a batch through COBOL and Fortran and seals it', async () => {
    const sample = await (await fetch(`${gh.base}/api/sample?size=200&seed=42`)).json();
    const res = await postJson(gh.base, '/api/batch', { transactions: sample.transactions });
    assert.equal(res.status, 200);
    const job = await res.json();
    assert.match(job.job, /^j-[0-9a-f]{24}$/);
    assert.deepEqual(job.stages.map((s) => s.name), ['gatehouse', 'txnguard', 'fraudscan', 'seal']);
    assert.equal(job.summary.received, 200);
    assert.equal(job.summary.accepted + job.summary.rejected, 200);
    assert.equal(job.ledger.entries.length, 200);
    assert.deepEqual(job.ledger.verification.verifiedBy, ['cobol-fortran', 'node-openssl', 'anchor']);
    assert.equal(job.risk.n, job.summary.accepted);
    // FRAUDSCAN finds every pattern the sample plants (gatehouse/src/sample.mjs).
    const signals = new Set(job.risk.transactions.flatMap((t) => t.signals));
    for (const signal of ['ZSCORE', 'STRUCTURING', 'VELOCITY', 'ENTROPY']) assert.ok(signals.has(signal), `no ${signal} in the sample`);
    const outlier = job.accepted.find((t) => t.amountCents === '2500000');
    assert.ok(job.risk.transactions.find((t) => t.id === outlier.id).signals.includes('ZSCORE'));
    assert.equal(job.risk.transactions.filter((t) => t.signals.includes('STRUCTURING')).length, 3);
    // Nothing raw leaves the core: card numbers only masked, no full IBANs.
    const body = JSON.stringify(job);
    for (const txn of sample.transactions) {
      if (txn.pan) assert.ok(!body.includes(txn.pan), 'raw card number leaked');
    }
    assert.ok(job.accepted.every((t) => /\*{6}/.test(t.fromMasked) && /^[0-9a-f]{16}$/.test(t.fromToken)));

    const again = await (await fetch(`${gh.base}/api/jobs/${job.job}`)).json();
    assert.equal(again.job, job.job);
    const missing = await fetch(`${gh.base}/api/jobs/j-${'0'.repeat(24)}`);
    assert.equal(missing.status, 404);
  });

  it('verifies, then detects tampering', async () => {
    const res = await postJson(gh.base, '/api/batch', { transactions: [VALID, { ...VALID, id: 'T-0002' }, { ...VALID, id: 'T-0003' }] });
    const job = await res.json();
    let verification = await (await postJson(gh.base, `/api/jobs/${job.job}/verify`, {})).json();
    assert.equal(verification.valid, true);
    const tampered = await (await postJson(gh.base, `/api/jobs/${job.job}/tamper`, { seq: 2, mode: 'amount' })).json();
    assert.equal(tampered.tampered, true);
    assert.notEqual(tampered.before, tampered.after);
    verification = await (await postJson(gh.base, `/api/jobs/${job.job}/verify`, {})).json();
    assert.deepEqual([verification.valid, verification.reason, verification.brokenAt], [false, 'MAC-MISMATCH', 2]);
    assert.deepEqual(verification.verifiedBy, ['cobol-fortran', 'node-openssl']);
    const bad = await postJson(gh.base, `/api/jobs/${job.job}/tamper`, { seq: 99, mode: 'amount' });
    assert.equal(bad.status, 400);
  });

  it('validates query parameters', async () => {
    assert.equal((await fetch(`${gh.base}/api/sample?size=0`)).status, 400);
    assert.equal((await fetch(`${gh.base}/api/sample?size=abc`)).status, 400);
    assert.equal((await fetch(`${gh.base}/api/sample?size=1001`)).status, 400);
  });

  it('reports its security posture', async () => {
    const posture = await (await fetch(`${gh.base}/api/posture`)).json();
    assert.equal(posture.sandbox.shell, false);
    assert.equal(posture.headers['content-security-policy'], CSP);
    assert.deepEqual(posture.dependencies, { runtime: 0, dev: 0 });
  });
});

describe('Gatehouse limits', { skip: SKIP_REASON }, () => {
  it('rate-limits API clients', async () => {
    const gh = await startGatehouse({ ALCAZAR_RATE_CAPACITY: '3', ALCAZAR_RATE_REFILL: '1' });
    try {
      const statuses = [];
      for (let i = 0; i < 5; i += 1) statuses.push((await fetch(`${gh.base}/api/health`)).status);
      assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
      assert.equal(statuses[4], 429);
      const res = await fetch(`${gh.base}/api/health`);
      assert.ok(Number(res.headers.get('retry-after')) >= 1);
    } finally {
      await gh.stop();
    }
  });

  it('refuses tampering outside demo mode and enforces the API token', async () => {
    const token = 's3cret-token-for-the-gatehouse-tests';
    const gh = await startGatehouse({ ALCAZAR_DEMO: '0', ALCAZAR_API_TOKEN: token });
    try {
      const auth = { authorization: `Bearer ${token}` };
      assert.equal((await postJson(gh.base, '/api/batch', { transactions: [VALID] })).status, 401);
      assert.equal((await postJson(gh.base, '/api/batch', { transactions: [VALID] }, { authorization: 'Bearer wrong' })).status, 401);
      const job = await (await postJson(gh.base, '/api/batch', { transactions: [VALID] }, auth)).json();
      const res = await postJson(gh.base, `/api/jobs/${job.job}/tamper`, { seq: 1, mode: 'amount' }, auth);
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error.code, 'P-DEMO');
      assert.equal((await fetch(`${gh.base}/api/health`)).status, 200);
    } finally {
      await gh.stop();
    }
  });
});

describe('Gatehouse request targets', { skip: SKIP_REASON }, () => {
  it('refuses network-path and absolute-form targets', async () => {
    const gh = await startGatehouse();
    try {
      const { request } = await import('node:http');
      const status = (path) => new Promise((resolve, reject) => {
        const url = new URL(gh.base);
        request({ host: url.hostname, port: url.port, path, headers: { host: url.host } }, (res) => {
          res.resume();
          resolve(res.statusCode);
        }).on('error', reject).end();
      });
      assert.equal(await status('//evil.example/api/health'), 404);
      assert.equal(await status('http://evil.example/api/health'), 404);
      assert.equal(await status('/api/health'), 200);
      const res = await fetch(`${gh.base}/api/health`, { method: 'DELETE' });
      assert.equal(res.status, 405);
      assert.equal(res.headers.get('allow'), 'GET');
    } finally {
      await gh.stop();
    }
  });
});

describe('Gatehouse HTTP parser errors', { skip: SKIP_REASON }, () => {
  it('answers malformed and oversized requests with the right status', async () => {
    const gh = await startGatehouse();
    try {
      const { connect } = await import('node:net');
      const url = new URL(gh.base);
      const raw = (payload) => new Promise((resolve, reject) => {
        const socket = connect(Number(url.port), url.hostname, () => socket.end(payload));
        let data = '';
        socket.on('data', (chunk) => { data += chunk; });
        socket.on('end', () => resolve(data.split('\r\n')[0]));
        socket.on('error', reject);
      });
      assert.equal(await raw('NONSENSE\r\n\r\n'), 'HTTP/1.1 400 Bad Request');
      assert.equal(await raw(`GET / HTTP/1.1\r\nHost: localhost\r\nX-Big: ${'a'.repeat(20000)}\r\n\r\n`), 'HTTP/1.1 431 Request Header Fields Too Large');
      assert.equal((await fetch(`${gh.base}/api/health`)).status, 200);
    } finally {
      await gh.stop();
    }
  });
});
