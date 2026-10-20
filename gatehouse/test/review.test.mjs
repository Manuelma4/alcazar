// SPDX-License-Identifier: Apache-2.0
// Regression tests for the findings of the independent security review of
// Gatehouse (process fan-out, slot hoarding, X-Forwarded-For spoofing,
// leftover card numbers, backslash targets, shutdown, eviction).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { Gate } from '../src/gate.mjs';
import { HttpError } from '../src/http.mjs';
import { SKIP_REASON, VALID, postJson, startGatehouse } from './helpers.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Open a raw socket that sends a request head and part of a body, then stalls. */
function stalledUpload(base) {
  const url = new URL(base);
  return new Promise((resolve) => {
    const socket = connect(Number(url.port), url.hostname, () => {
      socket.write(`POST /api/batch HTTP/1.1\r\nHost: ${url.host}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{`);
      resolve(socket);
    });
    socket.on('error', () => {});
  });
}

describe('Gate', () => {
  it('admits up to the limit, queues up to the queue size, then refuses', async () => {
    const gate = new Gate(2, 1);
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    let peak = 0;
    let running = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await hold;
      running -= 1;
    };
    const first = gate.run(task);
    const second = gate.run(task);
    const third = gate.run(task);
    await assert.rejects(gate.run(task), (error) => error instanceof HttpError && error.code === 'P-BUSY');
    release();
    await Promise.all([first, second, third]);
    assert.equal(peak, 2);
    assert.equal(gate.active, 0);
  });
});

describe('Gatehouse review regressions', { skip: SKIP_REASON }, () => {
  it('bounds the legacy processes a burst of verifications can start', async () => {
    const gh = await startGatehouse({ ALCAZAR_MAX_PROCESSES: '2', ALCAZAR_PROCESS_QUEUE: '4', ALCAZAR_RATE_CAPACITY: '1000' });
    try {
      const job = await (await postJson(gh.base, '/api/batch', { transactions: [VALID] })).json();
      const statuses = await Promise.all(Array.from({ length: 40 }, () =>
        postJson(gh.base, `/api/jobs/${job.job}/verify`, {}).then(async (res) => {
          if (res.status === 503) assert.equal((await res.json()).error.code, 'P-BUSY');
          else await res.arrayBuffer();
          return res.status;
        })));
      assert.ok(statuses.every((s) => s === 200 || s === 503), statuses.join(','));
      assert.ok(statuses.includes(503), 'the queue never filled');
      assert.ok(statuses.includes(200));
    } finally {
      await gh.stop();
    }
  });

  it('does not let stalled uploads hold the batch slots', async () => {
    const gh = await startGatehouse();
    const sockets = [await stalledUpload(gh.base), await stalledUpload(gh.base)];
    try {
      await sleep(200);
      const res = await postJson(gh.base, '/api/batch', { transactions: [VALID] });
      assert.equal(res.status, 200);
    } finally {
      for (const s of sockets) s.destroy();
      await gh.stop();
    }
  });

  it('keys the rate limit on the hop the trusted proxy added', async () => {
    const gh = await startGatehouse({ ALCAZAR_TRUST_PROXY: '1', ALCAZAR_RATE_CAPACITY: '3', ALCAZAR_RATE_REFILL: '1' });
    try {
      const statuses = [];
      for (let i = 0; i < 6; i += 1) {
        const res = await fetch(`${gh.base}/api/health`, { headers: { 'x-forwarded-for': `198.51.100.${i}, 203.0.113.9` } });
        await res.arrayBuffer();
        statuses.push(res.status);
      }
      assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
      assert.ok(statuses.slice(3).includes(429), statuses.join(','));
    } finally {
      await gh.stop();
    }
  });

  it('removes job directories (and raw card numbers) left by a crash', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'alcazar-orphan-'));
    const orphan = join(workDir, 'job-crashed');
    await mkdir(orphan);
    await writeFile(join(orphan, 'TXNIN.DAT'), '4111111111111111');
    const gh = await startGatehouse({}, { workDir });
    try {
      assert.equal(existsSync(orphan), false);
    } finally {
      await gh.stop();
    }
  });

  it('refuses request targets with a backslash', async () => {
    const gh = await startGatehouse();
    try {
      const url = new URL(gh.base);
      const status = await new Promise((resolve, reject) => {
        const socket = connect(Number(url.port), url.hostname, () => {
          socket.write(`GET /\\evil.example/api/health HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\n\r\n`);
        });
        let data = '';
        socket.on('data', (chunk) => { data += chunk; });
        socket.on('end', () => resolve(data.split(' ')[1]));
        socket.on('error', reject);
      });
      assert.equal(status, '404');
    } finally {
      await gh.stop();
    }
  });

  it('shuts down promptly even with a stalled upload', async () => {
    const gh = await startGatehouse();
    const socket = await stalledUpload(gh.base);
    const started = Date.now();
    await gh.stop();
    socket.destroy();
    assert.ok(Date.now() - started < 6000, `shutdown took ${Date.now() - started} ms`);
  });
});
