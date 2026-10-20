// Lookout · tests for the ledger state machine and the shared action flows,
// against a stubbed fetch (no network, no DOM).

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { chainStates, positionOfSeq } from '../js/ledgerstate.mjs';
import { launchSiege, tamperLedger, verifyLedger } from '../js/actions.mjs';
import { normalizeJob } from '../js/api.mjs';
import { store } from '../js/store.mjs';

const MAC = 'ab'.repeat(32);

function job({ id = 'j-0123456789abcdef01234567', seqs = [1, 2, 3, 4], received = 4, verification = { valid: true, verifiedBy: ['cobol-fortran', 'node-openssl', 'anchor'] } } = {}) {
  return normalizeJob({
    job: id,
    summary: { received },
    ledger: { entries: seqs.map((seq) => ({ seq, type: 'A', mac: MAC, raw: `line-${seq}` })), verification },
  });
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  store.patch({ job: null, ledgerBusy: false, verificationStale: false, lastTamper: null, siegeRun: null });
});

// ---------------------------------------------------------------------
describe('ledgerstate: classify entries from a verification', () => {
  test('valid chain: every entry verified', () => {
    const r = chainStates(job(), false);
    assert.deepEqual(r.states, ['verified', 'verified', 'verified', 'verified']);
    assert.deepEqual(r.ghosts, []);
    assert.equal(r.breakIndex, null);
  });

  test('MAC-MISMATCH: the entry breaks, later ones are unverifiable', () => {
    const r = chainStates(job({ verification: { valid: false, brokenAt: 2, reason: 'MAC-MISMATCH', verifiedBy: ['cobol-fortran', 'node-openssl'] } }), false);
    assert.deepEqual(r.states, ['verified', 'broken', 'unverifiable', 'unverifiable']);
    assert.equal(r.breakIndex, 1);
  });

  test('SEQ-GAP after deleting entry 2: a ghost where it was', () => {
    const r = chainStates(job({ seqs: [1, 3, 4], verification: { valid: false, brokenAt: 2, reason: 'SEQ-GAP' } }), false);
    assert.deepEqual(r.ghosts, [{ at: 1, from: 2, to: 2 }]);
    assert.deepEqual(r.states, ['verified', 'unverifiable', 'unverifiable']);
  });

  test('HEAD-MISMATCH after truncating at 3: chain intact, ghosts after the end', () => {
    const r = chainStates(job({ seqs: [1, 2], verification: { valid: false, brokenAt: 3, reason: 'HEAD-MISMATCH', verifiedBy: ['anchor'] } }), false);
    assert.deepEqual(r.states, ['verified', 'verified']);
    assert.deepEqual(r.ghosts, [{ at: 2, from: 3, to: 4 }]);
  });

  test('stale: nothing is claimed until verified again', () => {
    assert.deepEqual(chainStates(job(), true).states, ['unknown', 'unknown', 'unknown', 'unknown']);
  });

  test('SEQ to line position', () => {
    const entries = job({ seqs: [1, 3, 4] }).ledger.entries;
    assert.equal(positionOfSeq(entries, 3), 2);
    assert.equal(positionOfSeq(entries, 2), 0);
  });
});

// ---------------------------------------------------------------------
describe('actions: ledger verify / tamper', () => {
  test('a verification that lands after the job changed is discarded', async () => {
    let release;
    globalThis.fetch = (url) => {
      assert.match(String(url), /\/verify$/);
      return new Promise((resolve) => {
        release = () => resolve(json(200, { valid: true, entries: 4, head: MAC, brokenAt: null, reason: null, verifiedBy: ['anchor'], ms: 1 }));
      });
    };
    store.set('job', job());
    const pending = verifyLedger();
    const replacement = job({ id: 'j-fedcba9876543210fedcba98' });
    store.set('job', replacement);
    release();
    assert.equal(await pending, null);
    assert.equal(store.get('job'), replacement);
    assert.equal(store.get('ledgerBusy'), false);
  });

  test('one ledger action at a time', async () => {
    let release;
    globalThis.fetch = () => new Promise((resolve) => {
      release = () => resolve(json(200, { valid: true, entries: 4, verifiedBy: [], ms: 1 }));
    });
    store.set('job', job());
    const pending = verifyLedger();
    assert.equal(await tamperLedger(2, 'amount'), null, 'tamper refused while verify runs');
    release();
    await pending;
  });

  test('a tamper is recorded as stale even when the refresh fails', async () => {
    globalThis.fetch = (url, init) => {
      if (String(url).endsWith('/tamper')) return json(200, { tampered: true, seq: 2, mode: 'amount', before: 'a', after: 'b' });
      assert.equal(init.method, 'GET');
      return json(503, { error: { layer: 'gatehouse', code: 'P-BUSY', status: 503, message: 'busy' } });
    };
    store.set('job', job());
    const result = await tamperLedger(2, 'amount');
    assert.equal(result.refreshError.code, 'P-BUSY');
    assert.equal(store.get('verificationStale'), true);
    assert.equal(store.get('job').ledger.verification.stale, true);
    assert.equal(store.get('lastTamper').entrySeq, 2);
    assert.equal(store.get('ledgerBusy'), false);
  });

  test('tampering by SEQ sends the line position after a delete', async () => {
    let sent = null;
    globalThis.fetch = (url, init) => {
      if (String(url).endsWith('/tamper')) {
        sent = JSON.parse(init.body);
        return json(200, { tampered: true, seq: sent.seq, mode: sent.mode, before: 'x', after: null });
      }
      return json(200, { job: 'j-0123456789abcdef01234567', ledger: { entries: [], verification: { valid: true } } });
    };
    store.set('job', job({ seqs: [1, 3, 4] }));
    await tamperLedger(3, 'delete');
    assert.deepEqual(sent, { seq: 2, mode: 'delete' });
    assert.deepEqual(await tamperLedger(2, 'delete'), { tampered: false, missing: true }, 'SEQ 2 is gone');
  });
});

describe('actions: Siege', () => {
  test('a second full siege cannot start while one runs', async () => {
    store.set('siegeRun', { running: true, done: 3, total: 26 });
    assert.equal(await launchSiege([{ id: 'x', title: 'x' }]), null);
    assert.equal(store.get('siegeRun').done, 3);
  });
});
