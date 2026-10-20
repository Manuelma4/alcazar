// SPDX-License-Identifier: Apache-2.0
// scripts/verify-ledger.mjs: an auditor's check of a sealed job with
// K_ledger only, outside Gatehouse.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ROOT } from '../src/config.mjs';
import { deriveKeys, keyLines, tamperRecord } from '../src/ledger.mjs';
import { parseSeal, txnInLines } from '../src/records.mjs';
import { runLegacy } from '../src/runner.mjs';
import { sampleBatch } from '../src/sample.mjs';
import { SKIP_REASON } from './helpers.mjs';

const JOB = 'j-audit';
const SCRIPT = join(ROOT, 'scripts', 'verify-ledger.mjs');

describe('verify-ledger (auditor, K_ledger only)', { skip: SKIP_REASON }, () => {
  const keys = deriveKeys(Buffer.alloc(32, 0x3c));
  let dir;
  let keyFile;
  let seal;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'alcazar-audit-'));
    const guard = await runLegacy(join(ROOT, 'build', 'bin', 'txnguard'), [JOB], {
      cwd: dir,
      stdin: Buffer.concat([keyLines(keys.ledger, keys.token), txnInLines(sampleBatch({ size: 40, seed: 3 }).transactions)]),
      timeoutMs: 20_000,
      maxOutputBytes: 65_536,
    });
    assert.ok(guard.code === 0 || guard.code === 4, guard.stderr);
    seal = parseSeal(guard.stdout);
    keyFile = join(dir, 'K_LEDGER.key');
    await writeFile(keyFile, keyLines(keys.ledger), { mode: 0o600 });
  });

  after(() => rm(dir, { recursive: true, force: true }));

  const audit = (...extra) => spawnSync(process.execPath, [SCRIPT, dir, JOB, '--ledger-key-file', keyFile, ...extra], { encoding: 'utf8' });

  it('says INTACT, with both verifiers and the anchor', () => {
    const result = audit('--entries', String(seal.entries), '--head', seal.head);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /node-openssl {3}OK, 40 entries/);
    assert.match(result.stdout, /cobol-fortran {2}OK, 40 entries/);
    assert.match(result.stdout, /INTACT, and matches the anchor/);
  });

  it('catches a truncation only with the anchor', () => {
    const result = audit('--entries', String(seal.entries + 1), '--head', seal.head);
    assert.equal(result.status, 4);
    assert.match(result.stdout, /HEAD-MISMATCH/);
  });

  it('says BROKEN when a record was rewritten', async () => {
    const original = await readFile(join(dir, 'ACCEPTED.DAT'), 'latin1');
    const changed = tamperRecord(await readFile(join(dir, 'LEDGER.DAT'), 'latin1'),
      { accepted: original, rejected: await readFile(join(dir, 'REJECTED.DAT'), 'latin1') }, 1);
    await writeFile(join(dir, changed.file), changed.text, 'latin1');
    try {
      const result = audit();
      assert.equal(result.status, 4);
      assert.match(result.stdout, /BROKEN at entry 1: RECORD-MISMATCH/);
    } finally {
      await writeFile(join(dir, 'ACCEPTED.DAT'), original, 'latin1');
    }
  });

  it('refuses a key file others can read, and a wrong key gives a broken chain', async () => {
    await chmod(keyFile, 0o644);
    try {
      assert.equal(audit().status, 2);
    } finally {
      await chmod(keyFile, 0o600);
    }
    const other = join(dir, 'OTHER.key');
    await writeFile(other, keyLines(keys.token), { mode: 0o600 });
    const result = spawnSync(process.execPath, [SCRIPT, dir, JOB, '--ledger-key-file', other], { encoding: 'utf8' });
    assert.equal(result.status, 4);
    assert.match(result.stdout, /CHAIN-BREAK/);
  });
});
