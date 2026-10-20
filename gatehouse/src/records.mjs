// SPDX-License-Identifier: Apache-2.0
// Fixed-width record formats shared with the COBOL / Fortran core
// (docs/ARCHITECTURE.md, section 2). Writers pad exactly; readers are strict
// and treat anything unexpected as an error: the legacy outputs are parsed
// as untrusted data too.

export const TXNIN_LENGTH = 200;
export const LEDGER_LENGTH = 246;
export const LEDGER_MAC_INPUT = 181;

const TXNIN_LAYOUT = [
  ['id', 12],
  ['timestamp', 14],
  ['from', 34],
  ['to', 34],
  ['amount', 18],
  ['currency', 3],
  ['pan', 19],
  ['channel', 3],
  ['memo', 40],
];

/** One 200-byte TXNIN record. Fields were validated by schema.mjs. */
export function txnInRecord(txn) {
  let record = '';
  for (const [name, width] of TXNIN_LAYOUT) {
    const value = txn[name] ?? '';
    if (value.length > width || !/^[\x20-\x7e]*$/.test(value)) {
      throw new Error(`field ${name} does not fit the record`);
    }
    record += value.padEnd(width, ' ');
  }
  return record.padEnd(TXNIN_LENGTH, ' ');
}

/** The TXNIN file: records back to back, no line terminators. */
export function txnInFile(transactions) {
  return Buffer.from(transactions.map(txnInRecord).join(''), 'latin1');
}

export class RecordError extends Error {}

function lines(text) {
  if (text === '') return [];
  if (!text.endsWith('\n')) throw new RecordError('missing final newline');
  return text.slice(0, -1).split('\n');
}

function field(line, start, length) {
  return line.slice(start, start + length);
}

function requirePattern(value, pattern, what) {
  if (!pattern.test(value)) throw new RecordError(`bad ${what}`);
  return value;
}

/** ACCEPTED.DAT (206 bytes, trailing blanks trimmed by LINE SEQUENTIAL). */
export function parseAccepted(text) {
  return lines(text).map((raw) => {
    if (raw.length < 147 || raw.length > 206 || !/^[\x20-\x7e]*$/.test(raw)) throw new RecordError('bad accepted record');
    const line = raw.padEnd(206, ' ');
    const pan = field(line, 147, 19).trimEnd();
    return {
      id: requirePattern(field(line, 0, 12).trimEnd(), /^[A-Z0-9-]{1,12}$/, 'id'),
      timestamp: requirePattern(field(line, 12, 14), /^\d{14}$/, 'timestamp'),
      fromToken: requirePattern(field(line, 26, 16), /^[0-9a-f]{16}$/, 'token'),
      toToken: requirePattern(field(line, 42, 16), /^[0-9a-f]{16}$/, 'token'),
      fromMasked: field(line, 58, 34).trimEnd(),
      toMasked: field(line, 92, 34).trimEnd(),
      amountCents: String(BigInt(requirePattern(field(line, 126, 15), /^\d{15}$/, 'amount'))),
      currency: requirePattern(field(line, 141, 3), /^[A-Z]{3}$/, 'currency'),
      channel: requirePattern(field(line, 144, 3), /^[A-Z]{3}$/, 'channel'),
      panMasked: pan === '' ? null : requirePattern(pan, /^[0-9*]{12,19}$/, 'masked card'),
      memo: field(line, 166, 40).trimEnd(),
    };
  });
}

/** REJECTED.DAT (64 bytes). */
export function parseRejected(text) {
  return lines(text).map((raw) => {
    if (raw.length < 22 || raw.length > 64 || !/^[\x20-\x7e]*$/.test(raw)) throw new RecordError('bad rejected record');
    const line = raw.padEnd(64, ' ');
    return {
      line: Number(requirePattern(field(line, 0, 6), /^\d{6}$/, 'line number')),
      legacyId: field(line, 6, 12).trimEnd(),
      code: requirePattern(field(line, 18, 4), /^E\d{3}$/, 'reason code'),
      field: field(line, 22, 12).trimEnd(),
      detail: field(line, 34, 30).trimEnd(),
    };
  });
}

/** LEDGER.DAT (246 bytes, `|`-separated fixed fields). */
export function parseLedger(text) {
  return lines(text).map(parseLedgerLine);
}

export function parseLedgerLine(raw) {
  if (raw.length !== LEDGER_LENGTH || !/^[\x20-\x7e]*$/.test(raw)) throw new RecordError('bad ledger line');
  const parts = raw.split('|');
  if (parts.length !== 11) throw new RecordError('bad ledger separators');
  const [seq, type, id, timestamp, code, amount, currency, fromMasked, panLast4, prev, mac] = parts;
  return {
    seq: Number(requirePattern(seq, /^\d{6}$/, 'sequence')),
    type: requirePattern(type, /^[AR]$/, 'entry type'),
    id: id.trimEnd(),
    timestamp,
    code: requirePattern(code, /^(A000|E\d{3})$/, 'code'),
    amountCents: String(BigInt(requirePattern(amount, /^\d{15}$/, 'amount'))),
    currency: currency.trimEnd(),
    fromMasked: fromMasked.trimEnd(),
    panLast4: panLast4.trimEnd(),
    prev: requirePattern(prev, /^[0-9a-f]{64}$/, 'previous MAC'),
    mac: requirePattern(mac, /^[0-9a-f]{64}$/, 'MAC'),
    raw,
  };
}

/** SUMMARY.DAT: KEY=VALUE lines. */
export function parseSummary(text) {
  const out = Object.create(null);
  for (const line of lines(text)) {
    const match = /^([A-Z][A-Z0-9-]{0,19})=([ -~]{0,64})$/.exec(line);
    if (!match) throw new RecordError('bad summary line');
    out[match[1]] = match[2];
  }
  if (out['ALZ-SUMMARY'] !== '1') throw new RecordError('not a TXNGUARD summary');
  const totals = Object.create(null);
  for (const [key, value] of Object.entries(out)) {
    const ccy = /^TOTAL-([A-Z]{3})$/.exec(key);
    if (ccy) totals[ccy[1]] = String(BigInt(requirePattern(value, /^\d{1,18}$/, 'total')));
  }
  const count = (key) => Number(requirePattern(out[key] ?? '', /^\d{1,6}$/, key));
  return {
    job: out.JOB,
    records: count('RECORDS'),
    accepted: count('ACCEPTED'),
    rejected: count('REJECTED'),
    ledgerEntries: count('LEDGER-ENTRIES'),
    ledgerHead: requirePattern(out['LEDGER-HEAD'] ?? '', /^[0-9a-f]{64}$/, 'ledger head'),
    selftest: out.SELFTEST,
    totalsByCurrency: totals,
  };
}

/** The single line LEDGERCK prints. */
export function parseLedgerck(stdout) {
  const line = stdout.trim();
  let m = /^ALZ-LEDGER\|STATUS=OK\|ENTRIES=(\d{6})\|HEAD=([0-9a-f]{64})$/.exec(line);
  if (m) return { valid: true, entries: Number(m[1]), head: m[2], brokenAt: null, reason: null };
  m = /^ALZ-LEDGER\|STATUS=BROKEN\|ENTRIES=(\d{6})\|SEQ=(\d{6})\|REASON=([A-Z-]{1,12})$/.exec(line);
  if (m) return { valid: false, entries: Number(m[1]), head: null, brokenAt: Number(m[2]), reason: m[3] };
  throw new RecordError('unexpected LEDGERCK output');
}

const SIGNALS = new Set(['ZSCORE', 'STRUCTURING', 'VELOCITY', 'ENTROPY']);
const VERDICTS = new Set(['close', 'acceptable', 'marginal', 'nonconforming', 'insufficient']);

function requireBasis(value) {
  if (value !== 'chi2' && value !== 'mad' && value !== 'none') throw new RecordError('bad Benford verdict basis');
  return value;
}

/** Validate FRAUDSCAN's RISK.JSON against the contract before passing it on. */
export function parseRisk(text) {
  let risk;
  try {
    risk = JSON.parse(text);
  } catch {
    throw new RecordError('RISK.JSON is not valid JSON');
  }
  const num = (v, what) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RecordError(`bad ${what}`);
    return v;
  };
  const nums = (a, n, what) => {
    if (!Array.isArray(a) || (n !== undefined && a.length !== n)) throw new RecordError(`bad ${what}`);
    return a.map((v) => num(v, what));
  };
  if (risk?.schema !== 'alcazar.fraudscan/v1') throw new RecordError('unknown risk schema');
  const b = risk.benford ?? {};
  if (!VERDICTS.has(b.verdict)) throw new RecordError('bad Benford verdict');
  const h = risk.amounts?.histogram ?? {};
  const counts = nums(h.counts, undefined, 'histogram');
  return {
    schema: risk.schema,
    n: num(risk.n, 'n'),
    benford: {
      n: num(b.n, 'benford n'),
      counts: nums(b.counts, 9, 'benford counts'),
      observed: nums(b.observed, 9, 'benford observed'),
      expected: nums(b.expected, 9, 'benford expected'),
      chi2: num(b.chi2, 'chi2'),
      pValue: num(b.pValue, 'p-value'),
      mad: num(b.mad, 'mad'),
      verdict: b.verdict,
      verdictBasis: requireBasis(b.verdictBasis),
    },
    amounts: {
      medianCents: num(risk.amounts.medianCents, 'median'),
      madCents: num(risk.amounts.madCents, 'mad'),
      minCents: num(risk.amounts.minCents, 'min'),
      maxCents: num(risk.amounts.maxCents, 'max'),
      histogram: { log10Edges: nums(h.log10Edges, counts.length + 1, 'edges'), counts },
    },
    thresholds: Object.fromEntries(
      ['z', 'zScaleFloor', 'structuringLowCents', 'structuringHighCents', 'velocityCount', 'velocityWindowS', 'entropyBits', 'entropyMinLength']
        .map((k) => [k, num(risk.thresholds?.[k], k)]),
    ),
    transactions: (Array.isArray(risk.transactions) ? risk.transactions : []).map((t) => {
      if (typeof t?.id !== 'string' || !/^[A-Z0-9-]{1,12}$/.test(t.id)) throw new RecordError('bad risk id');
      if (!Array.isArray(t.signals) || !t.signals.every((s) => SIGNALS.has(s))) throw new RecordError('bad signals');
      return {
        id: t.id,
        score: num(t.score, 'score'),
        z: t.z === null ? null : num(t.z, 'z'),
        entropy: t.entropy === null ? null : num(t.entropy, 'entropy'),
        signals: [...t.signals],
      };
    }),
    flagged: num(risk.flagged, 'flagged'),
  };
}
