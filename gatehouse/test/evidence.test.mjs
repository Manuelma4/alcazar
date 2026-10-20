// SPDX-License-Identifier: Apache-2.0
// Evidence that outlives the job: signed anchors, the evidence directory,
// and the audit keys derived from the master key — K_ledger and a public
// key, which can check a job and cannot forge one.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { verifyAnchor } from '../src/anchor.mjs';
import { ROOT } from '../src/config.mjs';
import { SKIP_REASON, VALID, postJson, startGatehouse } from './helpers.mjs';

const node = (script, ...args) => spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { encoding: 'utf8' });

describe('Evidence', { skip: SKIP_REASON }, () => {
  let dir;
  let gh;
  let masterFile;
  const evidence = () => join(dir, 'evidence');
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'alcazar-evidence-'));
    masterFile = join(dir, 'master.key');
    await writeFile(masterFile, `${'42'.repeat(32)}\n`, { mode: 0o600 });
    gh = await startGatehouse({ ALCAZAR_KEY_FILE: masterFile, ALCAZAR_EVIDENCE_DIR: evidence() }, { workDir: join(dir, 'work') });
  });
  after(async () => {
    await gh.stop();
    // Evidence is left read-only: make it removable again.
    for (const job of await readdir(evidence()).catch(() => [])) await chmod(join(evidence(), job), 0o700);
    await rm(dir, { recursive: true, force: true });
  });

  it('signs every anchor, served for download and checked with the public key from /api/health', async () => {
    const job = await (await postJson(gh.base, '/api/batch', { transactions: [VALID] })).json();
    const health = await (await fetch(`${gh.base}/api/health`)).json();
    assert.equal(health.anchorKey.algorithm, 'Ed25519');
    const res = await fetch(`${gh.base}/api/jobs/${job.job}/anchor`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-disposition'), `attachment; filename="${job.job}.anchor.json"`);
    const anchor = await res.json();
    assert.deepEqual(anchor, job.ledger.anchor);
    const checked = verifyAnchor(anchor, health.anchorKey.publicKey);
    assert.deepEqual([checked.job, checked.entries, checked.head], [job.job, job.ledger.entries.length, job.ledger.head]);
  });

  it('keeps each sealed job read-only, outside the job directory, for an auditor with the audit keys only', async () => {
    const job = await (await postJson(gh.base, '/api/batch', { transactions: [VALID, { ...VALID, id: 'T-0002', amount: '-5.00' }] })).json();
    const out = join(evidence(), job.job);
    assert.deepEqual((await readdir(out)).sort(), ['ACCEPTED.DAT', 'ANCHOR.json', 'LEDGER.DAT', 'REJECTED.DAT']);
    if (process.platform !== 'win32') {
      assert.equal((await stat(out)).mode & 0o777, 0o500);
      for (const name of await readdir(out)) assert.equal((await stat(join(out, name))).mode & 0o777, 0o400, name);
    }

    const keys = join(dir, `audit-${job.job}`);
    let result = node('audit-keys.mjs', '--master-key-file', masterFile, '--out', keys);
    assert.equal(result.status, 0, result.stderr);
    const publicKey = (await readFile(join(keys, 'ANCHOR.pub'), 'utf8')).trim();
    assert.equal(publicKey, (await (await fetch(`${gh.base}/api/health`)).json()).anchorKey.publicKey);
    assert.equal((await stat(join(keys, 'K_LEDGER.key'))).mode & 0o077, 0);
    assert.match(node('audit-keys.mjs', '--master-key-file', masterFile, '--out', keys).stderr, /already exists: audit keys are never overwritten/);

    result = node('verify-ledger.mjs', out, job.job, '--ledger-key-file', join(keys, 'K_LEDGER.key'),
      '--anchor', join(out, 'ANCHOR.json'), '--anchor-key', publicKey);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /cobol-fortran {2}OK, 2 entries/);
    assert.match(result.stdout, /INTACT, and matches the signed anchor/);
  });

  it('refuses an evidence directory inside the job directory', async () => {
    const work = join(dir, 'work-2');
    await assert.rejects(startGatehouse({ ALCAZAR_EVIDENCE_DIR: join(work, 'evidence') }, { workDir: work }), /must not contain one another/);
  });
});
