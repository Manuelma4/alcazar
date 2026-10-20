// Lookout · actions: the flows shared by several views (batch, demo, ledger
// verification and tampering, Siege). Views call these; these call api.mjs.

import { api, launchScenario, loadLab } from './api.mjs';
import { store } from './store.mjs';
import { projectInput } from './batch.mjs';
import { positionOfSeq } from './ledgerstate.mjs';
import { readPref, writePref } from './prefs.mjs';
import { announce } from './live.mjs';
import { t } from './strings.mjs';

const JOB_ID = /^j-[0-9a-f]{24}$/;

export async function loadHealth() {
  try {
    store.patch({ health: await api.health(), healthError: null });
  } catch (error) {
    store.patch({ healthError: error });
  }
}

export async function loadPosture() {
  try {
    store.set('posture', await api.posture());
  } catch (error) {
    store.set('posture', { error });
  }
}

export async function loadReport() {
  try {
    store.patch({ report: await api.watchtowerReport(), reportError: null });
  } catch (error) {
    store.patch({ report: null, reportError: error });
  }
}

export async function loadExamples() {
  try {
    store.set('examples', await api.watchtowerExamples());
  } catch (error) {
    store.set('examples', { error });
  }
}

/**
 * Submit a batch. Keeps only a masked projection of the input client-side.
 * @returns {Promise<object | null>} the job, or null on error (see store.batchError)
 */
export async function runBatch(transactions, source) {
  if (store.get('batchBusy')) return null;
  store.patch({ batchBusy: true, batchError: null });
  return submit(transactions, source);
}

/** Send a batch while `batchBusy` is already held by the caller. */
async function submit(transactions, source) {
  announce(t('batch.sending', { n: transactions.length }));
  try {
    const job = await api.batch(transactions);
    store.patch({
      job,
      jobInput: projectInput(transactions),
      jobSource: source,
      batchBusy: false,
      lastTamper: null,
      verificationStale: false,
      replayToken: store.get('replayToken') + 1,
    });
    writePref('job', `${job.job}|${job.expiresAt}`, 'session');
    announce(t('batch.done', {
      accepted: job.summary.accepted,
      rejected: job.summary.rejected,
      flagged: job.summary.flagged,
      verdict: job.ledger.verification.valid ? t('batch.sealOk') : t('batch.sealBad'),
    }));
    return job;
  } catch (error) {
    // The views show failures in a role=alert banner: announced once, there.
    store.patch({ batchBusy: false, batchError: error });
    return null;
  }
}

export async function fetchSample(size, seed) {
  return api.sample(size, seed);
}

/** The Overview's one-click demo: Gatehouse's 200-transfer sample, seed 42. */
export async function runDemo() {
  if (store.get('batchBusy')) return null;
  store.patch({ batchBusy: true, batchError: null });
  announce(t('demo.generating'));
  let sample;
  try {
    sample = await api.sample(200, 42);
  } catch (error) {
    store.patch({ batchBusy: false, batchError: error });
    return null;
  }
  return submit(sample.transactions, { kind: 'sample', size: 200, seed: sample.seed });
}

/** Re-attach to the job of this tab's session after a reload (jobs live 15 min). */
export async function restoreJob() {
  const saved = readPref('job', null, null, 'session') ?? '';
  const [id, expires] = saved.split('|');
  if (!id || !JOB_ID.test(id) || store.get('job')) return;
  // Jobs live 15 minutes: don't ask Gatehouse for one that has already expired.
  if (expires && Date.parse(expires) <= Date.now()) {
    writePref('job', null, 'session');
    return;
  }
  let job;
  try {
    job = await api.job(id);
  } catch {
    writePref('job', null, 'session');
    return;
  }
  // GET returns the last verification, which may predate a tamper made before
  // the reload: verify again rather than show a stale "intact".
  let stale = false;
  try {
    job.ledger.verification = await api.verify(id);
  } catch {
    job.ledger.verification = { ...job.ledger.verification, stale: true };
    stale = true;
  }
  if (!store.get('job')) store.patch({ job, jobSource: { kind: 'restored' }, verificationStale: stale });
}

export async function refreshJob() {
  const job = store.get('job');
  if (!job) return null;
  const fresh = await api.job(job.job);
  store.set('job', fresh);
  return fresh;
}

export function forgetJob() {
  writePref('job', null, 'session');
  store.patch({ job: null, jobInput: null, jobSource: null, lastTamper: null, verificationStale: false });
}

/** Re-run the three verifiers on the current job's ledger. */
export async function verifyLedger() {
  const job = store.get('job');
  if (!job || store.get('ledgerBusy')) return null;
  store.set('ledgerBusy', true);
  try {
    const verification = await api.verify(job.job);
    const current = store.get('job');
    if (!current || current.job !== job.job) return null;
    store.patch({ job: { ...current, ledger: { ...current.ledger, verification } }, verificationStale: false });
    announce(verification.valid
      ? t('seal.announce.valid', { entries: verification.entries, n: verification.verifiedBy.length })
      : t('seal.announce.broken', { reason: verification.reason ?? '', seq: verification.brokenAt ?? '' }));
    return verification;
  } finally {
    store.set('ledgerBusy', false);
  }
}

function markStale(job) {
  return { ...job, ledger: { ...job.ledger, verification: { ...job.ledger.verification, stale: true } } };
}

/**
 * Demo only: edit the ledger as an insider would.
 * @param {number} seq   the entry's SEQ (as shown on the tiles); Gatehouse
 *   addresses the ledger by line position, which differs after a delete.
 * @returns {Promise<object | null>} the tamper result (with `refreshError`
 *   when the ledger could not be re-read), or null when not applicable.
 */
export async function tamperLedger(seq, mode) {
  const job = store.get('job');
  if (!job || store.get('ledgerBusy')) return null;
  const position = positionOfSeq(job.ledger.entries, seq);
  if (position < 1) return { tampered: false, missing: true };
  store.set('ledgerBusy', true);
  try {
    const result = await api.tamper(job.job, position, mode);
    let current = store.get('job');
    if (!current || current.job !== job.job) return null;
    // The file has changed: record that before anything else can fail.
    store.patch({ job: markStale(current), lastTamper: { ...result, entrySeq: seq, at: Date.now() }, verificationStale: true });
    announce(t('seal.announce.tampered', { mode: t(`seal.mode.${mode}`), seq }));
    try {
      const fresh = await api.job(job.job);
      current = store.get('job');
      if (current && current.job === job.job) store.set('job', markStale(fresh));
      return result;
    } catch (error) {
      return { ...result, refreshError: error };
    }
  } finally {
    store.set('ledgerBusy', false);
  }
}

// ---------- Siege ----------
const queue = [];
let draining = false;
let cancelled = false;

function setScenario(id, value) {
  store.get('siege').set(id, value);
  store.emit('siege');
}

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const { scenario, resolve } = queue.shift();
    if (cancelled) {
      setScenario(scenario.id, { state: 'idle' });
      resolve(null);
      continue;
    }
    setScenario(scenario.id, { state: 'running' });
    try {
      const outcome = await launchScenario(scenario);
      setScenario(scenario.id, { state: 'done', outcome, at: Date.now() });
      if (!store.get('siegeRun')?.running) {
        const by = [outcome.layer ? t(`layer.${outcome.layer}`) : null, outcome.code].filter(Boolean).join(' ');
        announce(outcome.contained
          ? t(outcome.asExpected ? 'siege.announce.contained' : 'siege.announce.unexpected', { title: scenario.title, by })
          : t('siege.announce.breach', { title: scenario.title }));
      }
      resolve(outcome);
    } catch (error) {
      setScenario(scenario.id, { state: 'error', error: String(error?.message ?? error) });
      resolve(null);
    }
  }
  draining = false;
}

/** Queue one scenario (scenarios run one at a time). */
export function launch(scenario) {
  if (!store.get('siegeRun')?.running) cancelled = false;
  setScenario(scenario.id, { state: 'queued' });
  return new Promise((resolve) => {
    queue.push({ scenario, resolve });
    drain();
  });
}

/** Launch the full siege, sequentially, with progress in the store. */
export async function launchSiege(scenarios) {
  if (store.get('siegeRun')?.running) return null;
  cancelled = false;
  const run = { running: true, done: 0, total: scenarios.length, ids: scenarios.map((s) => s.id), startedAt: Date.now(), finishedAt: null, current: null };
  store.set('siegeRun', run);
  // Announced at the start and at the end only: one sentence per attack
  // would flood the screen reader's queue (the progress bar has the rest).
  announce(t('siege.announce.start', { n: run.total }));
  for (const scenario of scenarios) {
    if (cancelled) break;
    store.set('siegeRun', { ...store.get('siegeRun'), current: scenario.id });
    await launch(scenario);
    run.done += 1;
    store.set('siegeRun', { ...store.get('siegeRun'), done: run.done });
  }
  const finished = { ...store.get('siegeRun'), running: false, current: null, finishedAt: Date.now(), cancelled };
  store.set('siegeRun', finished);
  const results = scenarios.map((s) => store.get('siege').get(s.id)?.outcome).filter(Boolean);
  announce(t('siege.announce.done', {
    contained: results.filter((o) => o.contained).length,
    total: scenarios.length,
    expected: results.filter((o) => o.asExpected).length,
  }));
  return finished;
}

export function stopSiege() {
  cancelled = true;
}

export { loadLab };
