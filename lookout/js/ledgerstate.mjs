// Lookout · ledgerstate: classify every ledger entry from a Verification.
// Pure (no DOM) so the Seal view's logic is unit-tested in Node.
//
// Gatehouse reports `brokenAt` as the expected SEQ at the failing line
// position (1-based), and `entries` as the count verified before the break.

/**
 * @param {object} job    normalized Job
 * @param {boolean} stale  the ledger changed since its last verification
 * @returns {{ states: ('verified'|'broken'|'unverifiable'|'unknown')[],
 *   ghosts: { at: number, from: number, to: number }[], breakIndex: number | null }}
 *   ghosts: missing entries drawn before index `at` (at === length: after the last).
 */
export function chainStates(job, stale) {
  const entries = job.ledger.entries;
  const v = job.ledger.verification;
  // No verdict at all (a verifier failed): nothing is known, nothing is broken.
  const unverified = stale || v.stale === true || (!v.valid && v.reason === null);
  const states = entries.map(() => (unverified ? 'unknown' : 'verified'));
  const ghosts = [];
  if (unverified || v.valid) return { states, ghosts, breakIndex: null };
  const n = v.brokenAt ?? 1;
  const index = Math.max(0, Math.min(entries.length, n - 1));
  if (v.reason === 'HEAD-MISMATCH') {
    // The remaining chain is intact; entries from `n` on were cut off.
    const original = Math.max(job.summary.received, entries.length);
    if (original >= n) ghosts.push({ at: entries.length, from: n, to: original });
    return { states, ghosts, breakIndex: entries.length };
  }
  if (v.reason === 'SEQ-GAP') {
    // Line `index` carries a later SEQ: everything from it on is unverifiable.
    const found = entries[index]?.seq ?? n + 1;
    ghosts.push({ at: index, from: n, to: Math.max(n, found - 1) });
    for (let i = index; i < entries.length; i += 1) states[i] = 'unverifiable';
    return { states, ghosts, breakIndex: index };
  }
  if (index < entries.length) states[index] = 'broken';
  for (let i = index + 1; i < entries.length; i += 1) states[i] = 'unverifiable';
  return { states, ghosts, breakIndex: index };
}

/** 1-based line position of the entry with this SEQ, or 0 when it is gone. */
export function positionOfSeq(entries, seq) {
  return entries.findIndex((e) => e.seq === seq) + 1;
}
