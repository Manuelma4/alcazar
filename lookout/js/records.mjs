// Lookout · records: the fixed-width layouts from docs/ARCHITECTURE.md §2,
// rebuilt client-side from the masked JSON so the dashboard can show exactly
// what TXNGUARD wrote — with a 3270-style column ruler. Pure: no DOM.

/** [name, length, kind] — kind 'x' text (left-justified, space-padded) or '9' numeric (zero-padded). */
export const ACCEPTED_LAYOUT = Object.freeze([
  ['TXN-ID', 12, 'x'], ['TXN-TS', 14, '9'], ['FROM-TOKEN', 16, 'x'], ['TO-TOKEN', 16, 'x'],
  ['FROM-MASKED', 34, 'x'], ['TO-MASKED', 34, 'x'], ['AMOUNT-CENTS', 15, '9'], ['CURRENCY', 3, 'x'],
  ['CHANNEL', 3, 'x'], ['PAN-MASKED', 19, 'x'], ['MEMO', 40, 'x'],
]);
export const REJECTED_LAYOUT = Object.freeze([
  ['LINE-NO', 6, '9'], ['TXN-ID', 12, 'x'], ['CODE', 4, 'x'], ['FIELD', 12, 'x'], ['DETAIL', 30, 'x'],
]);
/** Ledger format v2. AMOUNT is the sign ("+", "-", or "?" when it did not parse) and 15 digits of cents. */
export const LEDGER_LAYOUT = Object.freeze([
  ['SEQ', 6, '9'], ['T', 1, 'x'], ['TXN-ID', 12, 'x'], ['TS', 14, '9'], ['CODE', 4, 'x'],
  ['AMOUNT', 16, 'x'], ['CCY', 3, 'x'], ['FROM-MASKED', 34, 'x'], ['PAN-LAST4', 19, 'x'],
  ['RECORD-MAC', 64, 'x'], ['PREV-MAC', 64, 'x'], ['MAC', 64, 'x'],
]);
export const LEDGER_LENGTH = 312;
/** MAC = HMAC-SHA256(K_ledger, first 247 bytes): everything before the final "|", RECORD-MAC and PREV-MAC included. */
export const LEDGER_MAC_INPUT = 247;

export function layoutWidth(layout, separator = '') {
  return layout.reduce((sum, [, len]) => sum + len, 0) + separator.length * (layout.length - 1);
}

function fit(value, len, kind) {
  const text = String(value ?? '');
  if (kind === '9') return text.replace(/\D/g, '').padStart(len, '0').slice(-len);
  return text.padEnd(len, ' ').slice(0, len);
}

/** Build a record from field values keyed by layout name. */
export function buildRecord(layout, values, separator = '') {
  return layout.map(([name, len, kind]) => fit(values[name], len, kind)).join(separator);
}

/** ACCEPTED.DAT record (206 bytes) for an AcceptedTxn. */
export function acceptedRecord(txn) {
  return buildRecord(ACCEPTED_LAYOUT, {
    'TXN-ID': txn.id,
    'TXN-TS': txn.timestamp,
    'FROM-TOKEN': txn.fromToken,
    'TO-TOKEN': txn.toToken,
    'FROM-MASKED': txn.fromMasked,
    'TO-MASKED': txn.toMasked,
    'AMOUNT-CENTS': txn.amountCents,
    CURRENCY: txn.currency,
    CHANNEL: txn.channel,
    'PAN-MASKED': txn.panMasked ?? '',
    MEMO: txn.memo,
  });
}

/** REJECTED.DAT record (64 bytes) for a Rejection. */
export function rejectedRecord(rejection) {
  return buildRecord(REJECTED_LAYOUT, {
    'LINE-NO': rejection.line,
    'TXN-ID': rejection.legacyId,
    CODE: rejection.code,
    FIELD: rejection.field,
    DETAIL: rejection.detail,
  });
}

/**
 * Cut a record into its fields.
 * @returns {{ name: string, start: number, length: number, text: string, separator?: boolean }[]}
 */
export function segments(record, layout, separator = '') {
  const out = [];
  let pos = 0;
  layout.forEach(([name, len], index) => {
    out.push({ name, start: pos, length: len, text: record.slice(pos, pos + len) });
    pos += len;
    if (separator && index < layout.length - 1) {
      out.push({ name: 'sep', start: pos, length: separator.length, text: record.slice(pos, pos + separator.length), separator: true });
      pos += separator.length;
    }
  });
  if (pos < record.length) out.push({ name: 'overflow', start: pos, length: record.length - pos, text: record.slice(pos) });
  return out;
}

export function ledgerSegments(raw) {
  return segments(String(raw ?? ''), LEDGER_LAYOUT, '|');
}

/** ISPF / 3270 column ruler: "----+----1----+----2…" (1-based columns). */
export function ruler(width) {
  let out = '';
  for (let col = 1; col <= width; col += 1) {
    if (col % 10 === 0) out += String((col / 10) % 10);
    else if (col % 5 === 0) out += '+';
    else out += '-';
  }
  return out;
}

/** Column ranges [start, end) where two equal-length-ish strings differ. */
export function diffRanges(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  const ranges = [];
  const n = Math.max(left.length, right.length);
  let start = -1;
  for (let i = 0; i < n; i += 1) {
    const differs = left[i] !== right[i];
    if (differs && start < 0) start = i;
    if (!differs && start >= 0) {
      ranges.push([start, i]);
      start = -1;
    }
  }
  if (start >= 0) ranges.push([start, n]);
  return ranges;
}
