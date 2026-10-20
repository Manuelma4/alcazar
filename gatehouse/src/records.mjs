// SPDX-License-Identifier: Apache-2.0
// Fixed-width record formats shared with the COBOL / Fortran core
// (docs/ARCHITECTURE.md, section 2). Writers pad exactly; readers are strict
// and treat anything unexpected as an error: the legacy outputs are parsed
// as untrusted data too.

export const TXNIN_LENGTH = 200;
// Sealed outputs: fixed-length records, each followed by a line feed.
export const ACCEPTED_LENGTH = 206;
export const REJECTED_LENGTH = 64;
// Ledger format v2: MAC = HMAC(K_ledger, first 247 bytes), RECORD-MAC and
// PREV-MAC included.
export const LEDGER_LENGTH = 312;
export const LEDGER_MAC_INPUT = 247;

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

/**
 * The batch as TXNGUARD reads it on stdin, after its keys: one 200-byte
 * record per line. It never becomes a file: raw card numbers stay off the
 * disk, and no input sits in the job directory for anyone to rewrite.
 */
export function txnInLines(transactions) {
  return Buffer.from(transactions.map((txn) => `${txnInRecord(txn)}\n`).join(''), 'latin1');
}

export class RecordError extends Error {}

/**
 * Cut a file into fixed-length records that each end in a line feed,
 * exactly as LEDGERCK reads it: a short or unterminated chunk is kept, with
 * `complete: false`, so a verifier can say where the file breaks.
 * @returns {{ data: string, complete: boolean }[]}
 */
export function fixedRecords(text, length) {
  const out = [];
  for (let at = 0; at < text.length; at += length + 1) {
    const chunk = text.slice(at, at + length + 1);
    out.push({ data: chunk.slice(0, length), complete: chunk.length === length + 1 && chunk.endsWith('\n') });
  }
  return out;
}

function strictRecords(text, length, what) {
  return fixedRecords(text, length).map(({ data, complete }) => {
    if (!complete || !/^[\x20-\x7e]*$/.test(data)) throw new RecordError(`bad ${what} record`);
    return data;
  });
}

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

/** ACCEPTED.DAT: 206-byte records. */
export function parseAccepted(text) {
  return strictRecords(text, ACCEPTED_LENGTH, 'accepted').map((line) => {
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

/** REJECTED.DAT: 64-byte records. */
export function parseRejected(text) {
  return strictRecords(text, REJECTED_LENGTH, 'rejected').map((line) => {
    return {
      line: Number(requirePattern(field(line, 0, 6), /^\d{6}$/, 'line number')),
      legacyId: field(line, 6, 12).trimEnd(),
      code: requirePattern(field(line, 18, 4), /^E\d{3}$/, 'reason code'),
      field: field(line, 22, 12).trimEnd(),
      detail: field(line, 34, 30).trimEnd(),
    };
  });
}

/** LEDGER.DAT, format v2: 312-byte `|`-separated records. */
export function parseLedger(text) {
  return strictRecords(text, LEDGER_LENGTH, 'ledger').map(parseLedgerLine);
}

const LEDGER_SEPARATORS = [6, 8, 21, 36, 41, 58, 62, 97, 117, 182, 247];

/**
 * One ledger entry, checked exactly as LEDGERCK checks its format: every
 * separator in place, printable ASCII, numeric fields numeric, the three
 * MACs 64 lower-case hex digits. The other fields are covered by the MAC.
 */
export function parseLedgerLine(raw) {
  if (raw.length !== LEDGER_LENGTH || !/^[\x20-\x7e]*$/.test(raw) || LEDGER_SEPARATORS.some((at) => raw[at] !== '|')) {
    throw new RecordError('bad ledger line');
  }
  return {
    seq: Number(requirePattern(field(raw, 0, 6), /^\d{6}$/, 'sequence')),
    type: requirePattern(field(raw, 7, 1), /^[AR]$/, 'entry type'),
    id: field(raw, 9, 12).trimEnd(),
    timestamp: field(raw, 22, 14),
    code: field(raw, 37, 4),
    sign: requirePattern(field(raw, 42, 1), /^[+?-]$/, 'sign'),
    amountCents: String(BigInt(requirePattern(field(raw, 43, 15), /^\d{15}$/, 'amount'))),
    currency: field(raw, 59, 3).trimEnd(),
    fromMasked: field(raw, 63, 34).trimEnd(),
    panLast4: field(raw, 98, 19).trimEnd(),
    recordMac: requirePattern(field(raw, 118, 64), /^[0-9a-f]{64}$/, 'record MAC'),
    prev: requirePattern(field(raw, 183, 64), /^[0-9a-f]{64}$/, 'previous MAC'),
    mac: requirePattern(field(raw, 248, 64), /^[0-9a-f]{64}$/, 'MAC'),
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

/** The line TXNGUARD prints on stdout at the end of a run: the anchor. */
export function parseSeal(stdout) {
  const m = /^ALZ-SEAL\|ENTRIES=(\d{6})\|HEAD=([0-9a-f]{64})$/.exec(stdout.trim());
  if (!m) throw new RecordError('unexpected TXNGUARD output');
  return { entries: Number(m[1]), head: m[2] };
}

/** The single line LEDGERCK prints. */
export function parseLedgerck(stdout) {
  const line = stdout.trim();
  let m = /^ALZ-LEDGER\|STATUS=OK\|ENTRIES=(\d{6})\|HEAD=([0-9a-f]{64})$/.exec(line);
  if (m) return { valid: true, entries: Number(m[1]), head: m[2], brokenAt: null, reason: null };
  m = /^ALZ-LEDGER\|STATUS=BROKEN\|ENTRIES=(\d{6})\|SEQ=(\d{6})\|REASON=([A-Z-]{1,16})$/.exec(line);
  if (m) return { valid: false, entries: Number(m[1]), head: null, brokenAt: Number(m[2]), reason: m[3] };
  throw new RecordError('unexpected LEDGERCK output');
}

const SIGNALS = new Set(['ZSCORE', 'STRUCTURING', 'VELOCITY', 'ENTROPY']);
const VERDICTS = new Set(['close', 'acceptable', 'marginal', 'nonconforming', 'insufficient']);

function requireBasis(value) {
  if (value !== 'chi2' && value !== 'mad' && value !== 'none') throw new RecordError('bad Benford verdict basis');
  return value;
}

/** The per-currency structuring bands: [lowCents, highCents) for each currency. */
function structuringBands(bands, num) {
  if (!Array.isArray(bands) || bands.length > 64) throw new RecordError('bad structuring bands');
  return bands.map((s) => {
    if (typeof s?.currency !== 'string' || !/^[A-Z]{3}$/.test(s.currency)) throw new RecordError('bad structuring currency');
    const band = { currency: s.currency, lowCents: num(s.lowCents, 'structuring band'), highCents: num(s.highCents, 'structuring band') };
    if (!(band.lowCents > 0 && band.lowCents < band.highCents)) throw new RecordError('bad structuring band');
    return band;
  });
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
    thresholds: {
      ...Object.fromEntries(['z', 'zScaleFloor', 'velocityCount', 'velocityWindowS', 'entropyBits', 'entropyMinLength']
        .map((k) => [k, num(risk.thresholds?.[k], k)])),
      structuring: structuringBands(risk.thresholds?.structuring, num),
    },
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
