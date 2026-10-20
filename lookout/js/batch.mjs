// Lookout · batch: parsing a pasted / uploaded batch and keeping a masked
// projection of it. Pure (no DOM) so it is unit-tested in Node.
//
// After submission the dashboard keeps only what it needs to explain a
// rejection — amount text, currency, channel, masked IBANs, the memo with
// its card-like digits masked — and never the card number: the transactions
// view lets go of the raw batch once it is sent.

import { maskIban, maskMemo, maskPan } from './format.mjs';

export const MAX_TRANSACTIONS = 1000;
export const MAX_BODY_BYTES = 512 * 1024;

/**
 * Parse JSON text into a list of transactions.
 * Accepts `{ "transactions": [...] }` or a bare array.
 * @returns {{ ok: true, transactions: object[], warnings: string[] } | { ok: false, error: string, detail?: string }}
 */
export function parseBatchText(text) {
  const source = String(text ?? '').trim();
  if (!source) return { ok: false, error: 'empty' };
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    return { ok: false, error: 'json', detail: String(error?.message ?? error).slice(0, 160) };
  }
  const warnings = [];
  let list;
  if (Array.isArray(value)) {
    list = value;
  } else if (value && typeof value === 'object' && Array.isArray(value.transactions)) {
    list = value.transactions;
    const extra = Object.keys(value).filter((k) => k !== 'transactions');
    if (extra.length) warnings.push('extra-keys');
  } else {
    return { ok: false, error: 'shape' };
  }
  if (list.length === 0) return { ok: false, error: 'none' };
  if (list.some((t) => t === null || typeof t !== 'object' || Array.isArray(t))) warnings.push('non-object');
  if (list.length > MAX_TRANSACTIONS) warnings.push('too-many');
  if (new TextEncoder().encode(JSON.stringify({ transactions: list })).length > MAX_BODY_BYTES) warnings.push('too-big');
  return { ok: true, transactions: list, warnings };
}

const cut = (value, n) => (typeof value === 'string' ? value.slice(0, n) : value === undefined || value === null ? '' : String(value).slice(0, n));

/** What the dashboard keeps about each submitted line (no PAN, masked IBANs). */
export function projectInput(transactions) {
  return transactions.map((t, index) => {
    const x = t && typeof t === 'object' ? t : {};
    return {
      line: index + 1,
      id: cut(x.id, 24),
      timestamp: cut(x.timestamp, 20),
      from: maskIban(cut(x.from, 42)),
      to: maskIban(cut(x.to, 42)),
      amount: cut(x.amount, 24),
      currency: cut(x.currency, 8),
      channel: cut(x.channel, 8),
      memo: maskMemo(cut(x.memo, 48)),
      card: x.pan ? maskPan(cut(x.pan, 32)) : '',
    };
  });
}

/** A short, masked preview row for the loader table. */
export function previewRows(transactions, limit = 5) {
  return projectInput(transactions.slice(0, limit));
}
