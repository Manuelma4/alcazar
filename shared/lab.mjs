// Siege — the attack lab. Scenarios shared by the dashboard and the test suite.
//
// Every scenario is sent to the real gateway and declares which defensive layer
// must contain it. `gatehouse/test/siege.test.mjs` runs all of them, so the
// dashboard can never claim a defence that the tests do not prove.
//
// This module is browser-safe: no Node.js imports.

/** @typedef {'gatehouse' | 'cobol' | 'fortran' | 'seal'} Layer */

/**
 * @typedef {object} Expected
 * @property {Layer} layer      layer that must contain the attack
 * @property {string} [code]    Gatehouse error code, TXNGUARD reason code or ledger reason
 * @property {string} [id]      transaction id that must be rejected or flagged
 * @property {string} [signal]  FRAUDSCAN signal that must be raised
 * @property {number} [status]  expected HTTP status (Gatehouse layer)
 * @property {number} [brokenAt] expected first broken ledger sequence
 */

export const LAYERS = /** @type {const} */ (['gatehouse', 'cobol', 'fortran', 'seal']);

const FR = 'FR7630006000011234567890189';
const DE = 'DE89370400440532013000';
const ES = 'ES9121000418450200051332';
const GB = 'GB29NWBK60161331926819';
const IT = 'IT60X0542811101000000123456';
const NL = 'NL91ABNA0417164300';
const BE = 'BE68539007547034';

/** A valid transfer; scenarios override the field under attack. */
function txn(overrides = {}) {
  return {
    id: 'LAB-0001',
    timestamp: '20251020101500',
    from: FR,
    to: DE,
    amount: '125.00',
    currency: 'EUR',
    channel: 'WEB',
    memo: 'Invoice 2025-117',
    ...overrides,
  };
}

/** Ten transfers from one account: nine ordinary ones and one outlier. */
function anomalyBatch() {
  const amounts = ['42.10', '55.00', '38.75', '61.20', '47.90', '52.30', '44.60', '58.10', '49.99'];
  const rows = amounts.map((amount, i) => txn({
    id: `LAB-Z${String(i + 1).padStart(3, '0')}`,
    timestamp: `202510${String(10 + i).padStart(2, '0')}091500`,
    from: ES,
    to: [DE, GB, IT][i % 3],
    amount,
    memo: 'Groceries',
  }));
  rows.push(txn({ id: 'LAB-Z999', timestamp: '20251020031200', from: ES, to: NL, amount: '48000.00', memo: 'Urgent' }));
  return rows;
}

function structuringBatch() {
  return [
    txn({ id: 'LAB-S001', timestamp: '20251020090000', from: BE, to: DE, amount: '9950.00', memo: 'Consulting' }),
    txn({ id: 'LAB-S002', timestamp: '20251020113000', from: BE, to: GB, amount: '9900.00', memo: 'Consulting' }),
    txn({ id: 'LAB-S003', timestamp: '20251020151500', from: BE, to: IT, amount: '9875.00', memo: 'Consulting' }),
  ];
}

function velocityBatch() {
  return Array.from({ length: 6 }, (_, i) => txn({
    id: `LAB-V00${i + 1}`,
    timestamp: `2025102022${String(10 + i).padStart(2, '0')}00`,
    from: NL,
    to: [DE, GB, IT, ES, BE, FR][i],
    amount: `${20 + i}.00`,
    channel: 'MOB',
    memo: 'Gift card',
  }));
}

function ledgerBatch() {
  return [
    txn({ id: 'LAB-L001', amount: '100.00' }),
    txn({ id: 'LAB-L002', amount: '250.00', to: GB }),
    txn({ id: 'LAB-L003', amount: '75.50', to: IT }),
    txn({ id: 'LAB-L004', amount: '980.00', to: NL }),
  ];
}

/** @type {readonly object[]} */
export const SCENARIOS = Object.freeze([
  {
    id: 'sign-flip',
    category: 'integrity',
    cwe: 'CWE-195',
    title: 'Sign-flip transfer',
    summary: 'A negative amount that a naive MOVE into an unsigned PIC 9 field would silently turn positive.',
    request: { kind: 'batch', transactions: [txn({ amount: '-500.00' })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E403' },
  },
  {
    id: 'truncation',
    category: 'integrity',
    cwe: 'CWE-197',
    title: 'High-order truncation',
    summary: '14 integer digits: MOVE would drop the leading digit and store 2,345,678,901,234.50.',
    request: { kind: 'batch', transactions: [txn({ amount: '12345678901234.50' })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E402' },
  },
  {
    id: 'salami',
    category: 'integrity',
    cwe: 'CWE-682',
    title: 'Fractional-cent “salami” amount',
    summary: 'Three decimals are rejected instead of being rounded away in the attacker’s favour.',
    request: { kind: 'batch', transactions: [txn({ amount: '10.005' })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E401' },
  },
  {
    id: 'iban-checksum',
    category: 'validation',
    cwe: 'CWE-354',
    title: 'Forged IBAN check digits',
    summary: 'One digit changed in the sender IBAN — ISO 7064 mod 97-10 catches it.',
    request: { kind: 'batch', transactions: [txn({ from: 'FR7630006000011234567890188' })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E302' },
  },
  {
    id: 'iban-alias',
    category: 'validation',
    cwe: 'CWE-1289',
    title: 'IBAN alias (check digits 99)',
    summary: 'FR99… and FR02… name the same account and both pass MOD 97-10, but only 02–98 are ever issued: an alias would dodge the same-account and per-sender checks.',
    request: { kind: 'batch', transactions: [txn({ from: 'FR9930006000011234567890163', to: 'FR0230006000011234567890163' })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E302' },
  },
  {
    id: 'pan-luhn',
    category: 'validation',
    cwe: 'CWE-354',
    title: 'Invalid card number',
    summary: 'A card number that fails the Luhn check digit.',
    request: { kind: 'batch', transactions: [txn({ pan: '4111111111111112', channel: 'POS' })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E602' },
  },
  {
    id: 'currency',
    category: 'validation',
    cwe: 'CWE-20',
    title: 'Unlisted currency',
    summary: 'Currencies are checked against an explicit ISO 4217 allowlist.',
    request: { kind: 'batch', transactions: [txn({ currency: 'BTC' })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E501' },
  },
  {
    id: 'calendar',
    category: 'validation',
    cwe: 'CWE-20',
    title: 'Impossible date (30 February)',
    summary: 'Calendar validity is checked with FUNCTION TEST-DATE-YYYYMMDD.',
    request: { kind: 'batch', transactions: [txn({ timestamp: '20250230101500' })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E201' },
  },
  {
    id: 'replay',
    category: 'integrity',
    cwe: 'CWE-294',
    title: 'Replayed transaction id',
    summary: 'The same transaction submitted twice in one batch.',
    request: { kind: 'batch', transactions: [txn({ id: 'LAB-R001' }), txn({ id: 'LAB-R001', amount: '9000.00' })] },
    expected: { layer: 'cobol', id: 'LAB-R001', code: 'E102' },
  },
  {
    id: 'self-transfer',
    category: 'logic',
    cwe: 'CWE-840',
    title: 'Self-transfer loop',
    summary: 'Sender and beneficiary are the same account — a classic business-logic abuse.',
    request: { kind: 'batch', transactions: [txn({ to: FR })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E305' },
  },
  {
    id: 'formula-injection',
    category: 'injection',
    cwe: 'CWE-1236',
    title: 'Spreadsheet formula injection',
    summary: 'A memo starting with “-” would execute as a formula when an analyst opens the export in Excel.',
    request: { kind: 'batch', transactions: [txn({ memo: '-2+3+cmd' })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E802' },
  },
  {
    id: 'pan-in-memo',
    category: 'injection',
    cwe: 'CWE-312',
    title: 'Card number in the memo',
    summary: 'A full card number typed into free text would leave the core in clear text; ALZPANSC finds it and the transfer is refused.',
    request: { kind: 'batch', transactions: [txn({ memo: 'card 4111 1111 1111 1111 exp 12/28' })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E803' },
  },
  {
    id: 'xss-memo',
    category: 'injection',
    cwe: 'CWE-79',
    title: 'Stored XSS in the memo',
    summary: 'HTML in the memo is outside the SEPA character set; the dashboard would render it as text anyway.',
    request: { kind: 'batch', transactions: [txn({ memo: '<img src=x onerror=alert(1)>' })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E801' },
  },
  {
    id: 'sqli-memo',
    category: 'injection',
    cwe: 'CWE-89',
    title: 'SQL injection payload',
    summary: 'Fixed-width records are never concatenated into queries, and “;” is not a SEPA character.',
    request: { kind: 'batch', transactions: [txn({ memo: "x'; DROP TABLE ledger;--" })] },
    expected: { layer: 'cobol', id: 'LAB-0001', code: 'E801' },
  },
  {
    id: 'cmd-injection',
    category: 'injection',
    cwe: 'CWE-78',
    title: 'Shell metacharacters in the id',
    summary: 'Gatehouse never uses a shell (execFile, fixed argv) and TXNGUARD rejects the identifier.',
    request: { kind: 'batch', transactions: [txn({ id: 'A;rm -rf /' })] },
    expected: { layer: 'cobol', id: 'A;rm -rf /', code: 'E101' },
  },
  {
    id: 'record-injection',
    category: 'injection',
    cwe: 'CWE-93',
    title: 'Record injection (CR/LF)',
    summary: 'A newline in the memo would start a forged fixed-width record.',
    request: {
      kind: 'batch',
      transactions: [txn({ memo: 'ok\nLAB-9999  20251020101500' })],
    },
    expected: { layer: 'gatehouse', code: 'P-CHARSET', status: 400 },
  },
  {
    id: 'trojan-source',
    category: 'injection',
    cwe: 'CWE-451',
    title: 'Bidirectional text (Trojan Source)',
    summary: 'Unicode bidi overrides can make text display differently from what is processed.',
    request: { kind: 'batch', transactions: [txn({ memo: 'Refund \u{202E}etouq\u{202C}' })] },
    expected: { layer: 'gatehouse', code: 'P-CHARSET', status: 400 },
  },
  {
    id: 'prototype-pollution',
    category: 'protocol',
    cwe: 'CWE-1321',
    title: 'Prototype pollution',
    summary: 'Unknown keys such as “__proto__” are rejected by the schema.',
    request: {
      kind: 'raw',
      method: 'POST',
      path: '/api/batch',
      headers: { 'content-type': 'application/json' },
      body: '{"transactions":[],"__proto__":{"isAdmin":true}}',
    },
    expected: { layer: 'gatehouse', code: 'P-SCHEMA', status: 400 },
  },
  {
    id: 'content-type',
    category: 'protocol',
    cwe: 'CWE-352',
    title: 'Cross-site form post',
    summary: 'text/plain bodies (the CSRF-friendly content type) are refused.',
    request: {
      kind: 'raw',
      method: 'POST',
      path: '/api/batch',
      headers: { 'content-type': 'text/plain' },
      body: '{"transactions":[]}',
    },
    expected: { layer: 'gatehouse', code: 'P-MEDIA', status: 415 },
  },
  {
    id: 'path-traversal',
    category: 'protocol',
    cwe: 'CWE-22',
    title: 'Path traversal',
    summary: 'Static files are served from an in-memory allowlist — there is no filesystem path to traverse.',
    request: { kind: 'raw', method: 'GET', path: '/assets/..%2f..%2f..%2fetc%2fpasswd' },
    expected: { layer: 'gatehouse', code: 'P-NOTFOUND', status: 404 },
  },
  {
    id: 'flood',
    category: 'availability',
    cwe: 'CWE-770',
    title: 'Oversized batch',
    summary: 'More than 1,000 transactions in one request.',
    request: {
      kind: 'batch',
      transactions: Array.from({ length: 1001 }, (_, i) => txn({ id: `LAB-F${String(i).padStart(4, '0')}` })),
    },
    expected: { layer: 'gatehouse', code: 'P-LIMIT', status: 400 },
  },
  {
    id: 'structuring',
    category: 'fraud',
    cwe: null,
    title: 'Structuring (smurfing)',
    summary: 'Three valid transfers just under the 10,000 reporting threshold.',
    request: { kind: 'batch', transactions: structuringBatch() },
    expected: { layer: 'fortran', id: 'LAB-S002', signal: 'STRUCTURING' },
  },
  {
    id: 'velocity',
    category: 'fraud',
    cwe: null,
    title: 'Card-testing velocity',
    summary: 'Six small transfers from one account in five minutes.',
    request: { kind: 'batch', transactions: velocityBatch() },
    expected: { layer: 'fortran', id: 'LAB-V006', signal: 'VELOCITY' },
  },
  {
    id: 'anomaly',
    category: 'fraud',
    cwe: null,
    title: 'Account-takeover outlier',
    summary: 'An account that usually moves ~50 EUR suddenly sends 48,000 EUR at 03:12.',
    request: { kind: 'batch', transactions: anomalyBatch() },
    expected: { layer: 'fortran', id: 'LAB-Z999', signal: 'ZSCORE' },
  },
  {
    id: 'exfiltration',
    category: 'fraud',
    cwe: 'CWE-200',
    title: 'Data exfiltration via memo',
    summary: 'A high-entropy token smuggled in the free-text memo.',
    request: { kind: 'batch', transactions: [txn({ id: 'LAB-X001', memo: 'K7Q2M9X4V8B1N6C3Z5L0P7R2T9W4Y1' })] },
    expected: { layer: 'fortran', id: 'LAB-X001', signal: 'ENTROPY' },
  },
  {
    id: 'ledger-tamper',
    category: 'audit',
    cwe: 'CWE-345',
    title: 'Insider edits the ledger',
    summary: 'The amount of entry 2 is changed after the fact; its HMAC no longer matches.',
    request: { kind: 'tamper', transactions: ledgerBatch(), seq: 2, mode: 'amount' },
    expected: { layer: 'seal', code: 'MAC-MISMATCH', brokenAt: 2 },
  },
  {
    id: 'record-tamper',
    category: 'audit',
    cwe: 'CWE-353',
    title: 'Redirected payment',
    summary: 'The beneficiary of transfer 2 is rewritten in ACCEPTED.DAT and the ledger is left alone — but each entry seals its whole record.',
    request: { kind: 'tamper', transactions: ledgerBatch(), seq: 2, mode: 'record' },
    expected: { layer: 'seal', code: 'RECORD-MISMATCH', brokenAt: 2 },
  },
  {
    id: 'ledger-delete',
    category: 'audit',
    cwe: 'CWE-345',
    title: 'Deleted audit entry',
    summary: 'Entry 2 is removed to hide a transfer; the chain sequence breaks.',
    request: { kind: 'tamper', transactions: ledgerBatch(), seq: 2, mode: 'delete' },
    expected: { layer: 'seal', code: 'SEQ-GAP', brokenAt: 2 },
  },
  {
    id: 'ledger-truncate',
    category: 'audit',
    cwe: 'CWE-345',
    title: 'Truncated ledger',
    summary: 'The last entries and their records are cut off. What is left is a valid, shorter ledger — only the external anchor reveals it.',
    request: { kind: 'tamper', transactions: ledgerBatch(), seq: 3, mode: 'truncate' },
    expected: { layer: 'seal', code: 'HEAD-MISMATCH', brokenAt: 3 },
  },
]);

/**
 * @typedef {object} Outcome
 * @property {string} id
 * @property {boolean} contained   some layer stopped or flagged the attack
 * @property {boolean} asExpected  it was the expected layer with the expected code
 * @property {Layer | null} layer
 * @property {string | null} code
 * @property {number | null} status  HTTP status of the attack request
 * @property {string} detail
 * @property {number} ms
 */

/**
 * Launch one scenario against the gateway.
 * @param {object} scenario
 * @param {{ fetch?: typeof fetch, base?: string }} [options]
 * @returns {Promise<Outcome>}
 */
export async function runScenario(scenario, { fetch: fetchImpl = globalThis.fetch, base = '' } = {}) {
  const started = Date.now();
  const finish = (fields) => {
    const outcome = { id: scenario.id, layer: null, code: null, status: null, detail: '', ...fields, ms: Date.now() - started };
    outcome.contained = outcome.layer !== null;
    outcome.asExpected = matches(scenario.expected, outcome);
    return outcome;
  };
  const { request } = scenario;

  if (request.kind === 'raw') {
    const res = await fetchImpl(base + request.path, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
    const body = await readJson(res);
    if (body?.error?.layer === 'gatehouse') {
      return finish({ layer: 'gatehouse', code: body.error.code, status: res.status, detail: body.error.message });
    }
    return finish({ status: res.status, detail: `HTTP ${res.status}` });
  }

  const res = await postJson(fetchImpl, `${base}/api/batch`, { transactions: request.transactions });
  const job = await readJson(res);
  if (!res.ok) {
    if (job?.error?.layer === 'gatehouse') {
      return finish({ layer: 'gatehouse', code: job.error.code, status: res.status, detail: job.error.message });
    }
    return finish({ status: res.status, detail: `HTTP ${res.status}` });
  }

  if (request.kind === 'tamper') {
    const tampered = await postJson(fetchImpl, `${base}/api/jobs/${encodeURIComponent(job.job)}/tamper`,
      { seq: request.seq, mode: request.mode });
    if (!tampered.ok) {
      const err = await readJson(tampered);
      return finish({ status: tampered.status, detail: err?.error?.message ?? `HTTP ${tampered.status}` });
    }
    const verify = await postJson(fetchImpl, `${base}/api/jobs/${encodeURIComponent(job.job)}/verify`, {});
    const verification = await readJson(verify);
    if (verification && verification.valid === false) {
      return finish({
        layer: 'seal',
        code: verification.reason,
        status: verify.status,
        brokenAt: verification.brokenAt,
        detail: `${verification.reason} at entry ${verification.brokenAt}`,
      });
    }
    return finish({ status: verify.status, detail: 'Ledger still verifies' });
  }

  const targetId = scenario.expected.id;
  const rejection = job.rejections.find((r) => r.id === targetId) ?? null;
  if (rejection) {
    return finish({ layer: 'cobol', code: rejection.code, status: res.status, detail: `${rejection.code} ${rejection.message}` });
  }
  const risk = job.risk.transactions.find((t) => t.id === targetId && t.signals.length > 0) ?? null;
  if (risk) {
    return finish({
      layer: 'fortran',
      code: risk.signals.join('+'),
      signals: risk.signals,
      status: res.status,
      detail: `score ${risk.score} · ${risk.signals.join(', ')}`,
    });
  }
  return finish({ status: res.status, detail: 'Accepted without any signal' });
}

function matches(expected, outcome) {
  if (outcome.layer !== expected.layer) return false;
  if (expected.status !== undefined && outcome.status !== expected.status) return false;
  if (expected.signal !== undefined) return (outcome.signals ?? []).includes(expected.signal);
  if (expected.code !== undefined && outcome.code !== expected.code) return false;
  if (expected.brokenAt !== undefined && outcome.brokenAt !== expected.brokenAt) return false;
  return true;
}

function postJson(fetchImpl, url, payload) {
  return fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
