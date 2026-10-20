// Lookout · jobmodel: joins a Job back into input order. Pure (no DOM).
//
// TXNGUARD keeps input order in ACCEPTED.DAT, so the k-th accepted transfer
// is the k-th line that was not rejected; FRAUDSCAN's risk rows join by id
// (accepted ids are unique — duplicates are E102); the Seal writes one entry
// per input line, so an untampered entry's seq is its line number.

import { centsToUnits, formatMoney } from './format.mjs';

/**
 * @param {object} job   normalized Job
 * @param {object[] | null} input  masked projection of the submitted batch
 */
export function buildRows(job, input = null) {
  const rejByLine = new Map(job.rejections.map((r) => [r.line, r]));
  const riskById = new Map(job.risk.transactions.map((r) => [r.id, r]));
  const entryBySeq = new Map(job.ledger.entries.map((e) => [e.seq, e]));
  const usableInput = Array.isArray(input) && input.length === job.summary.received ? input : null;
  const rows = [];
  let k = 0;
  for (let line = 1; line <= job.summary.received; line += 1) {
    const rejection = rejByLine.get(line);
    const submitted = usableInput ? usableInput[line - 1] : null;
    const entry = entryBySeq.get(line) ?? null;
    if (rejection) {
      rows.push({ line, status: 'rejected', id: rejection.id, rejection, accepted: null, risk: null, input: submitted, entry });
      continue;
    }
    const accepted = job.accepted[k];
    k += 1;
    if (!accepted) continue;
    const risk = riskById.get(accepted.id) ?? null;
    rows.push({
      line,
      status: risk && risk.signals.length ? 'flagged' : 'accepted',
      id: accepted.id,
      rejection: null,
      accepted,
      risk,
      input: submitted,
      entry,
    });
  }
  return rows;
}

/** Lower-case haystack for the transactions search box. */
export function searchText(row) {
  const parts = [row.id, String(row.line)];
  if (row.accepted) {
    const a = row.accepted;
    parts.push(a.fromMasked, a.toMasked, a.memo, a.channel, a.currency, a.fromToken, a.toToken);
  }
  if (row.rejection) {
    const r = row.rejection;
    parts.push(r.code, r.field, r.detail, r.message, r.legacyId);
  }
  if (row.input) parts.push(row.input.from, row.input.to, row.input.memo, row.input.amount, row.input.currency, row.input.channel);
  if (row.risk) parts.push(...row.risk.signals);
  return parts.filter(Boolean).join(' ').toLowerCase();
}

export function filterRows(rows, { filter = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === 'accepted' && row.status === 'rejected') return false;
    if (filter === 'rejected' && row.status !== 'rejected') return false;
    if (filter === 'flagged' && row.status !== 'flagged') return false;
    return q ? searchText(row).includes(q) : true;
  });
}

/** Rejections grouped by reason code, most frequent first. */
export function reasonCounts(job) {
  const map = new Map();
  for (const r of job.rejections) {
    const entry = map.get(r.code) ?? { code: r.code, field: r.field, message: r.message, count: 0 };
    entry.count += 1;
    map.set(r.code, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

/** Highest FRAUDSCAN scores, joined with the accepted transfer. */
export function topRisk(job, limit = 10) {
  const byId = new Map(job.accepted.map((a) => [a.id, a]));
  return job.risk.transactions
    .filter((r) => r.score > 0 || r.signals.length > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((risk) => ({ risk, accepted: byId.get(risk.id) ?? null }));
}

/** ZSCORE outliers with their exact log10 position (major units). */
export function outliers(job) {
  const byId = new Map(job.accepted.map((a) => [a.id, a]));
  return job.risk.transactions
    .filter((r) => r.signals.includes('ZSCORE'))
    .map((r) => {
      const a = byId.get(r.id);
      const units = a ? centsToUnits(a.amountCents) : NaN;
      return a && units > 0 ? { id: r.id, log: Math.log10(units), amount: formatMoney(a.amountCents, a.currency), z: r.z } : null;
    })
    .filter(Boolean);
}

/**
 * The histogram's log10 edges are in major units per the contract's
 * log10(amount). Guard anyway: if the first non-empty bin can only contain
 * the minimum when read as cents, convert the edges to units.
 */
export function histogramEdgesInUnits(amounts) {
  const { log10Edges: edges, counts } = amounts.histogram;
  const firstBin = counts.findIndex((c) => c > 0);
  if (firstBin < 0 || !(amounts.minCents > 0)) return edges;
  const lo = edges[firstBin];
  const hi = edges[firstBin + 1];
  const inUnits = Math.log10(amounts.minCents / 100);
  const inCents = Math.log10(amounts.minCents);
  const fits = (v) => v >= lo - 1e-9 && v <= hi + 1e-9;
  if (!fits(inUnits) && fits(inCents)) return edges.map((e) => e - 2);
  return edges;
}

/** Totals by currency, largest first, as [currency, cents] pairs. */
export function totals(job) {
  const big = (v) => BigInt(String(v).replace(/\D/g, '') || '0');
  return Object.entries(job.summary.totalsByCurrency)
    .filter(([ccy]) => /^[A-Z]{3}$/.test(ccy))
    .sort((a, b) => {
      const d = big(b[1]) - big(a[1]);
      if (d > 0n) return 1;
      if (d < 0n) return -1;
      return a[0].localeCompare(b[0]);
    });
}
