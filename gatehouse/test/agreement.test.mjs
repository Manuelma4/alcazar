// SPDX-License-Identifier: Apache-2.0
// Differential test of the two Seal verifiers. TXNGUARD seals a real batch;
// then the ledger and its ACCEPTED / REJECTED records are damaged in random
// ways — bytes flipped, inserted or deleted, records duplicated, dropped,
// swapped or truncated, CRs and NULs planted — and LEDGERCK (COBOL + the
// Fortran HMAC kernel) and the Node.js / OpenSSL verifier must return the
// same verdict, entry count, break position, reason and head every time.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ROOT } from '../src/config.mjs';
import { deriveKeys, keyLines, tamperLedger, tamperRecord, verifyLedger } from '../src/ledger.mjs';
import { ACCEPTED_LENGTH, LEDGER_LENGTH, REJECTED_LENGTH, parseLedgerck, txnInFile } from '../src/records.mjs';
import { runLegacy } from '../src/runner.mjs';
import { sampleBatch } from '../src/sample.mjs';
import { SKIP_REASON } from './helpers.mjs';

const JOB = 'j-agreement';
const BIN = join(ROOT, 'build', 'bin');
const FILES = ['LEDGER.DAT', 'ACCEPTED.DAT', 'REJECTED.DAT'];
// Bytes that matter to a record reader: terminators, NUL, separators, DEL, Latin-1.
const BYTES = ['\n', '\r', '\0', '|', ' ', '0', 'a', 'A', '\x7f', '\xe9'];
const WIDTH = { 'LEDGER.DAT': LEDGER_LENGTH + 1, 'ACCEPTED.DAT': ACCEPTED_LENGTH + 1, 'REJECTED.DAT': REJECTED_LENGTH + 1 };

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

/** One random way an insider (or a bad disk) could change the files. */
function mutate(files, rand) {
  const pick = (n) => Math.floor(rand() * n);
  const name = FILES[pick(FILES.length)];
  const text = files[name];
  const at = pick(text.length + 1);
  const width = WIDTH[name];
  const records = text.match(new RegExp(`[^]{1,${width}}`, 'g')) ?? [];
  const r = pick(Math.max(records.length, 1));
  const byte = () => BYTES[pick(BYTES.length)];
  const out = { ...files };
  switch (pick(9)) {
    case 0: out[name] = text.slice(0, at) + byte() + text.slice(at + 1); break;
    case 1: out[name] = text.slice(0, at) + text.slice(at + 1 + pick(4)); break;
    case 2: out[name] = text.slice(0, at) + byte() + text.slice(at); break;
    case 3: out[name] = text.slice(0, at); break;
    case 4: if (records.length) out[name] = [...records.slice(0, r + 1), records[r], ...records.slice(r + 1)].join(''); break;
    case 5: if (records.length) out[name] = [...records.slice(0, r), ...records.slice(r + 1)].join(''); break;
    case 6: if (records.length > 1) {
      const s = (r + 1) % records.length;
      const swapped = [...records];
      [swapped[r], swapped[s]] = [swapped[s], swapped[r]];
      out[name] = swapped.join('');
    } break;
    case 7: {
      const entries = Math.floor(files['LEDGER.DAT'].length / WIDTH['LEDGER.DAT']);
      if (entries) out['LEDGER.DAT'] = tamperLedger(files['LEDGER.DAT'], 1 + pick(entries), ['amount', 'delete', 'truncate'][pick(3)]).text;
    } break;
    default: {
      const entries = Math.floor(files['LEDGER.DAT'].length / WIDTH['LEDGER.DAT']);
      if (entries) {
        const changed = tamperRecord(files['LEDGER.DAT'], { accepted: files['ACCEPTED.DAT'], rejected: files['REJECTED.DAT'] }, 1 + pick(entries));
        out[changed.file] = changed.text;
      }
    }
  }
  return out;
}

describe('Seal verifiers agree (LEDGERCK vs Node.js / OpenSSL)', { skip: SKIP_REASON }, () => {
  const keys = deriveKeys(randomBytes(32));
  let dir;
  let pristine;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'alcazar-agreement-'));
    await writeFile(join(dir, 'TXNIN.DAT'), txnInFile(sampleBatch({ size: 60, seed: 7 }).transactions));
    const guard = await runLegacy(join(BIN, 'txnguard'), [JOB], {
      cwd: dir, stdin: keyLines(keys.ledger, keys.token), timeoutMs: 20_000, maxOutputBytes: 65_536,
    });
    assert.ok(guard.code === 0 || guard.code === 4, guard.stderr);
    pristine = Object.fromEntries(await Promise.all(FILES.map(async (f) => [f, await readFile(join(dir, f), 'latin1')])));
  });

  after(() => rm(dir, { recursive: true, force: true }));

  async function both(files) {
    for (const f of FILES) await writeFile(join(dir, f), files[f], 'latin1');
    const check = await runLegacy(join(BIN, 'ledgerck'), [JOB], {
      cwd: dir, stdin: keyLines(keys.ledger), timeoutMs: 20_000, maxOutputBytes: 65_536,
    });
    assert.ok(check.code === 0 || check.code === 4, `LEDGERCK rc ${check.code}: ${check.stderr}`);
    const cobol = parseLedgerck(check.stdout);
    const node = verifyLedger(files['LEDGER.DAT'], keys.ledger, JOB, { accepted: files['ACCEPTED.DAT'], rejected: files['REJECTED.DAT'] });
    return { cobol, node };
  }

  it('agree on the intact ledger', async () => {
    const { cobol, node } = await both(pristine);
    assert.equal(cobol.valid, true);
    assert.deepEqual(cobol, node);
  });

  it('agree on 250 random corruptions of the ledger and its records', async () => {
    const rand = prng(20261020);
    const reasons = new Set();
    for (let i = 0; i < 250; i += 1) {
      let files = mutate(pristine, rand);
      if (rand() < 0.3) files = mutate(files, rand);
      const { cobol, node } = await both(files);
      assert.deepEqual(cobol, node, `case ${i}`);
      reasons.add(cobol.reason ?? 'VALID');
    }
    // The corpus must reach every verdict, or the agreement proves little.
    for (const reason of ['FORMAT', 'SEQ-GAP', 'CHAIN-BREAK', 'MAC-MISMATCH', 'RECORD-MISMATCH']) {
      assert.ok(reasons.has(reason), `no case ended in ${reason}`);
    }
  });
});
