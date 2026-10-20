// SPDX-License-Identifier: Apache-2.0
// Regression tests for the findings of the independent security review of
// Gatehouse (process fan-out, slot hoarding, X-Forwarded-For spoofing,
// leftover card numbers, backslash targets, shutdown, eviction).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ROOT } from '../src/config.mjs';
import { Gate } from '../src/gate.mjs';
import { HttpError } from '../src/http.mjs';
import { deriveKeys, keyLines } from '../src/ledger.mjs';
import { runLegacy } from '../src/runner.mjs';
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

describe('Least-privilege keys for the legacy programs', { skip: SKIP_REASON }, () => {
  const keys = deriveKeys(Buffer.alloc(32, 0x5c));
  const run = async (name, stdin) => {
    const dir = await mkdtemp(join(tmpdir(), 'alcazar-keys-'));
    try {
      await writeFile(join(dir, 'LEDGER.DAT'), '');
      return await runLegacy(join(ROOT, 'build', 'bin', name), ['j-keys'], { cwd: dir, stdin, timeoutMs: 10_000, maxOutputBytes: 65_536 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it('TXNGUARD runs with K-ledger and K-token', async () => {
    const result = await run('txnguard', keyLines(keys.ledger, keys.token));
    assert.equal(result.code, 0, result.stderr);
  });

  it('TXNGUARD refuses a single key (a master key sent as before)', async () => {
    const result = await run('txnguard', keyLines(keys.ledger));
    assert.equal(result.code, 12);
    assert.match(result.stderr, /64 lower-case hex digits on its own line/);
  });

  it('TXNGUARD refuses the same key for both purposes', async () => {
    const result = await run('txnguard', keyLines(keys.ledger, keys.ledger));
    assert.equal(result.code, 12);
    assert.match(result.stderr, /K-ledger and K-token must differ/);
  });

  it('TXNGUARD reads its batch on stdin, one record per line, and refuses a malformed stream', async () => {
    const record = `${'T-1'.padEnd(12)}${'20251020101500'}${'FR7630006000011234567890189'.padEnd(34)}${'DE89370400440532013000'.padEnd(34)}`
      + `${'125.00'.padEnd(18)}EUR${''.padEnd(19)}WEB${'Rent'.padEnd(40)}`.padEnd(200 - 94);
    assert.equal(record.length, 200);
    const keysThen = (text) => Buffer.concat([keyLines(keys.ledger, keys.token), Buffer.from(text, 'latin1')]);
    assert.equal((await run('txnguard', keysThen(`${record}\n`))).code, 0, 'one valid record');
    assert.equal((await run('txnguard', keysThen(`${record.slice(0, 100)}\n`))).code, 8, 'a short line refuses the batch');
    assert.equal((await run('txnguard', keysThen(`${'0123456789abcdef'.repeat(4)}\n${record}\n`))).code, 8, 'a stray third key line too');
    assert.equal((await run('txnguard', keysThen(`\n${record}\n`))).code, 8, 'an empty line too');
    const long = await run('txnguard', keysThen(`${record}X\n`));
    assert.equal(long.code, 8, 'an over-long line refuses the batch');
    assert.match(long.stderr, /every input line must be one 200-byte record/);
    assert.equal((await run('txnguard', keysThen(record))).code, 8, 'a record without its line feed refuses the batch');
  });

  it('LEDGERCK refuses to be handed K-token too', async () => {
    const result = await run('ledgerck', keyLines(keys.ledger, keys.token));
    assert.equal(result.code, 12);
    assert.match(result.stderr, /more than the keys this program may hold/);
  });

  it('TXNGUARD refuses a key line without its line feed', async () => {
    const result = await run('txnguard', keyLines(keys.ledger, keys.token).subarray(0, 129));
    assert.equal(result.code, 12);
  });

  it('LEDGERCK verifies with K-ledger alone', async () => {
    const result = await run('ledgerck', keyLines(keys.ledger));
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /^ALZ-LEDGER\|STATUS=OK\|ENTRIES=000000\|/);
  });
});

// Written from the ways people type card numbers, not from ALZPANSC's
// algorithm: the reference model mirrors that algorithm and could share
// its blind spots.
describe('TXNGUARD finds card numbers however they are typed', { skip: SKIP_REASON }, () => {
  let gh;
  before(async () => {
    gh = await startGatehouse();
  });
  after(() => gh.stop());

  const CARDS = [
    'card 4111 1111 1111 1111', '4111-1111-1111-1111', '4111.1111.1111.1111', '4111/1111/1111/1111',
    '4111111111111111', '4111 1111 1111 1111 123', 'card 4111 1111 1111 1111 12/28', '12/28 4111 1111 1111 1111',
    '4111-1111-1111-1111-1228', 'cvv 737 5105 1051 0510 5100', 'amex 3782 822463 10005', '6011 1111 1111 1117',
    'card4111 1111 1111 1111', '4111  1111 1111 1111', 'Ref 99 / 4111 1111 1111 1111', 'VISA4111111111111111',
    'PAN4111-1111-1111-1111', 'diners 3056 9309 0259 04', 'visa 4222 2222 2222 2', 'REF A12 4111 1111 1111 1111',
    'BE68 5390 0754 7034 4111 1111 1111 1111', 'jcb 3530 1113 3330 0000', 'dankort 5019 1234 5678 9013',
    'bancontact 6703 1234 5678 9012 1', 'borica 2205 1234 5678 9014', 'diners 3095 1234 5678 97',
  ];
  const ORDINARY = [
    'Invoice 2025-117', 'Inv 5234-567 05.10.2025 qty 12', 'Order 523456 2025-10-12', 'tel 06 12 34 56 78',
    'Refund DE89 3704 0044 0532 0130 00', 'DE08 2789 2536 2826 0240 19', 'RF18 5390 0754 7034', 'Total 1.234.567,89',
    'refund fr75 0001 4093 1234 5975 1277 407', 'DE89 4111 1111 1111 1111 11', 'SIRET 552 081 317 00018', 'SIRET 55208131700018',
    'IMEI 352099001761481',
  ];

  it('refuses every card number with E803 and lets ordinary memos through', async () => {
    const memos = [...CARDS, ...ORDINARY];
    const transactions = memos.map((memo, i) => ({ ...VALID, id: `M-${i + 1}`, memo }));
    const res = await postJson(gh.base, '/api/batch', { transactions });
    assert.equal(res.status, 200);
    const job = await res.json();
    const codes = new Map(job.rejections.map((r) => [r.id, r.code]));
    memos.forEach((memo, i) => {
      const expected = i < CARDS.length ? 'E803' : undefined;
      assert.equal(codes.get(`M-${i + 1}`), expected, `memo ${JSON.stringify(memo)}`);
    });
    // And no full card number in what Gatehouse returns.
    assert.ok(!JSON.stringify(job).includes('4111111111111111'));
  });
});

describe('Master key file', { skip: SKIP_REASON }, () => {
  it('is read as bytes, with or without a final newline, and refused when malformed or readable by others', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'alcazar-keyfile-'));
    const file = join(dir, 'master.key');
    try {
      await writeFile(file, `${'5c'.repeat(32)}\n`, { mode: 0o600 });
      const gh = await startGatehouse({ ALCAZAR_KEY_FILE: file }, { workDir: join(dir, 'work') });
      try {
        const health = await (await fetch(`${gh.base}/api/health`)).json();
        assert.equal(health.keySource, 'file');
        assert.equal(health.selftest.status, 'pass');
      } finally {
        await gh.stop();
      }
      await writeFile(file, `${'5C'.repeat(32)}\n`);
      await assert.rejects(startGatehouse({ ALCAZAR_KEY_FILE: file }, { workDir: join(dir, 'work') }), /64 lower-case hex digits/);
      await writeFile(file, `${'5c'.repeat(32)}`);
      await chmod(file, 0o644);
      await assert.rejects(startGatehouse({ ALCAZAR_KEY_FILE: file }, { workDir: join(dir, 'work') }), /chmod 600/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reaches the hardened launcher from a secret mount outside the repository, and never from the job directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'alcazar-secret-'));
    const secrets = join(dir, 'secrets');
    const work = join(dir, 'work');
    try {
      await mkdir(secrets, { mode: 0o700 });
      await writeFile(join(secrets, 'master.key'), `${'5c'.repeat(32)}\n`, { mode: 0o600 });
      const run = startHardened({ ALCAZAR_KEY_FILE: join(secrets, 'master.key'), ALCAZAR_WORK_DIR: work });
      try {
        const health = await (await fetch(`${await run.ready}api/health`)).json();
        assert.equal(health.keySource, 'file');
        assert.equal(health.selftest.status, 'pass');
      } finally {
        run.child.kill('SIGTERM');
        await run.closed;
      }
      // A key file that is not there stops the launcher before anything listens.
      await assert.rejects(startHardened({ ALCAZAR_KEY_FILE: join(secrets, 'absent.key'), ALCAZAR_WORK_DIR: work }).ready, /ALCAZAR_KEY_FILE/);
      // The job directory is the insider's territory.
      await writeFile(join(work, 'master.key'), `${'5c'.repeat(32)}\n`, { mode: 0o600 });
      await assert.rejects(startHardened({ ALCAZAR_KEY_FILE: join(work, 'master.key'), ALCAZAR_WORK_DIR: work }).ready,
        /"Gatehouse cannot start".*inside the job directory/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/** `npm start`: the launcher that runs Gatehouse under the permission model. */
function startHardened(env) {
  const child = spawn(process.execPath, [join(ROOT, 'scripts', 'start-hardened.mjs')], {
    env: { ...process.env, ALCAZAR_HOST: '127.0.0.1', ALCAZAR_PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve) => child.on('close', resolve));
  const ready = new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const line = stdout.split('\n').find((l) => l.includes('"Gatehouse listening"'));
      if (line) resolve(JSON.parse(line).url);
    });
    closed.then((code) => reject(new Error(`the launcher exited with ${code}: ${stderr}`)));
  });
  return { child, ready, closed };
}

describe('A verification that cannot complete', { skip: SKIP_REASON }, () => {
  it('leaves the job "not verified", never its last "valid"', async () => {
    const work = await mkdtemp(join(tmpdir(), 'alcazar-unverified-'));
    const gh = await startGatehouse({}, { workDir: work });
    try {
      const res = await postJson(gh.base, '/api/batch', { transactions: [VALID] });
      const job = await res.json();
      assert.equal(job.ledger.verification.valid, true);
      // The job's directory, from outside: the ledger becomes unreadable.
      const [dir] = (await readdir(work)).filter((name) => name.startsWith('job-'));
      await rm(join(work, dir, 'LEDGER.DAT'));
      await mkdir(join(work, dir, 'LEDGER.DAT'));
      const verify = await postJson(gh.base, `/api/jobs/${job.job}/verify`, {});
      assert.ok(verify.status >= 500, `status ${verify.status}`);
      const after = await (await fetch(`${gh.base}/api/jobs/${job.job}`)).json();
      assert.deepEqual([after.ledger.verification.valid, after.ledger.verification.reason, after.ledger.verification.verifiedBy], [false, null, []]);
    } finally {
      await gh.stop();
      await rm(work, { recursive: true, force: true });
    }
  });
});
