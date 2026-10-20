// SPDX-License-Identifier: Apache-2.0
// An insider with write access to the job directory, acting *while* a job
// runs: between TXNGUARD and Gatehouse, during verification, or on
// TXNGUARD's input. Pipeline.legacy is wrapped only to act at those
// moments, exactly as such an insider would.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadConfig } from '../src/config.mjs';
import { HttpError } from '../src/http.mjs';
import { tamperLedger, tamperRecord, trimRecords } from '../src/ledger.mjs';
import { Pipeline } from '../src/pipeline.mjs';
import { SKIP_REASON } from './helpers.mjs';

const BASE = { timestamp: '20251020101500', amount: '125.00', currency: 'EUR', pan: '', channel: 'WEB', memo: 'Rent' };
const BATCH = [
  { ...BASE, id: 'T-1', from: 'FR7630006000011234567890189', to: 'DE89370400440532013000' },
  { ...BASE, id: 'T-2', from: 'DE89370400440532013000', to: 'GB29NWBK60161331926819', amount: '900000.00' },
];
const NOT_WHAT_WAS_SENT = (error) => error instanceof HttpError && error.code === 'P-LEGACY' &&
  /does not match the submitted batch|inconsistent/.test(error.message);

describe('An insider inside a running job', { skip: SKIP_REASON }, () => {
  let work;
  let pipeline;
  let real;
  before(async () => {
    work = await mkdtemp(join(tmpdir(), 'alcazar-insider-'));
    pipeline = new Pipeline({ config: loadConfig({ ALCAZAR_WORK_DIR: work }), masterKey: Buffer.alloc(32, 7) });
    real = pipeline.legacy.bind(pipeline);
  });
  after(() => rm(work, { recursive: true, force: true }));

  /** Run the batch with `hook(name, dir, when)` called before and after every legacy program. */
  async function runWith(hook) {
    pipeline.legacy = async (name, args, dir, stdin) => {
      await hook(name, dir, 'before');
      const result = await real(name, args, dir, stdin);
      await hook(name, dir, 'after');
      return result;
    };
    try {
      return await pipeline.run(BATCH, { validationMs: 0 });
    } finally {
      pipeline.legacy = real;
    }
  }
  const read = (dir, name) => readFile(join(dir, name), 'latin1');

  it('redirecting a payment in ACCEPTED.DAT right after TXNGUARD fails the job', async () => {
    let original = null;
    await assert.rejects(runWith(async (name, dir, when) => {
      if (name === 'txnguard' && when === 'after') {
        original = await read(dir, 'ACCEPTED.DAT');
        const changed = tamperRecord(await read(dir, 'LEDGER.DAT'), { accepted: original, rejected: await read(dir, 'REJECTED.DAT') }, 1);
        await writeFile(join(dir, 'ACCEPTED.DAT'), changed.text, 'latin1');
      }
      // ...and put back before anything is verified.
      if (name === 'fraudscan' && when === 'before' && original) await writeFile(join(dir, 'ACCEPTED.DAT'), original, 'latin1');
    }), NOT_WHAT_WAS_SENT);
  });

  it('cutting the ledger, its records and SUMMARY.DAT at sealing time fails the job', async () => {
    await assert.rejects(runWith(async (name, dir, when) => {
      if (name !== 'txnguard' || when !== 'after') return;
      const cut = tamperLedger(await read(dir, 'LEDGER.DAT'), 2, 'truncate');
      const records = trimRecords(cut.text, { accepted: await read(dir, 'ACCEPTED.DAT'), rejected: await read(dir, 'REJECTED.DAT') });
      await writeFile(join(dir, 'LEDGER.DAT'), cut.text, 'latin1');
      await writeFile(join(dir, 'ACCEPTED.DAT'), records.accepted, 'latin1');
      await writeFile(join(dir, 'REJECTED.DAT'), records.rejected, 'latin1');
      const summary = (await read(dir, 'SUMMARY.DAT')).replace(/^ACCEPTED=\d+$/m, 'ACCEPTED=1')
        .replace(/^LEDGER-ENTRIES=\d+$/m, 'LEDGER-ENTRIES=1').replace(/^LEDGER-HEAD=[0-9a-f]+$/m, `LEDGER-HEAD=${cut.text.slice(248, 312)}`)
        .replace(/^TOTAL-EUR=\d+$/m, 'TOTAL-EUR=12500');
      await writeFile(join(dir, 'SUMMARY.DAT'), summary, 'latin1');
    }), NOT_WHAT_WAS_SENT);
  });

  it('raising an amount in TXNIN.DAT before TXNGUARD reads it fails the job', async () => {
    await assert.rejects(runWith(async (name, dir, when) => {
      if (name !== 'txnguard' || when !== 'before') return;
      const input = await read(dir, 'TXNIN.DAT');
      // AMOUNT is at offset 94, 18 bytes: 125.00 becomes 925.00.
      await writeFile(join(dir, 'TXNIN.DAT'), `${input.slice(0, 94)}${'925.00'.padEnd(18)}${input.slice(112)}`, 'latin1');
    }), NOT_WHAT_WAS_SENT);
  });

  it('an edit made while LEDGERCK runs is never reported valid', async () => {
    const { state } = await runWith(async () => {});
    pipeline.legacy = async (name, args, dir, stdin) => {
      if (name === 'ledgerck') {
        const changed = tamperRecord(await read(dir, 'LEDGER.DAT'), { accepted: await read(dir, 'ACCEPTED.DAT'), rejected: await read(dir, 'REJECTED.DAT') }, 1);
        await writeFile(join(dir, changed.file), changed.text, 'latin1');
      }
      return real(name, args, dir, stdin);
    };
    try {
      const verification = await pipeline.verify(state);
      assert.equal(verification.valid, false);
    } finally {
      pipeline.legacy = real;
    }
  });

  it('deleting the files is a verdict, not an error', async () => {
    const { state } = await runWith(async () => {});
    await rm(join(state.dir, 'LEDGER.DAT'));
    assert.deepEqual(await pick(pipeline.verify(state)), { valid: false, reason: 'RECORD-MISMATCH', brokenAt: 1 });
    await rm(join(state.dir, 'ACCEPTED.DAT'));
    await rm(join(state.dir, 'REJECTED.DAT'));
    // Nothing left: a valid empty ledger, which only the anchor contradicts.
    assert.deepEqual(await pick(pipeline.verify(state)), { valid: false, reason: 'HEAD-MISMATCH', brokenAt: 1 });
  });
});

async function pick(promise) {
  const { valid, reason, brokenAt } = await promise;
  return { valid, reason, brokenAt };
}
