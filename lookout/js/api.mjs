// Lookout · api: the only module that talks to Gatehouse.
//
// It knows the contract in docs/ARCHITECTURE.md §5 and nothing else. Every
// response is untrusted: it is projected onto the contract's fields with
// explicit types (unknown fields dropped, maps rebuilt on null-prototype
// objects), so the views can only ever render well-typed values — as text.

export const STAGES = Object.freeze(['gatehouse', 'txnguard', 'fraudscan', 'seal']);
export const SIGNALS = Object.freeze(['ZSCORE', 'STRUCTURING', 'VELOCITY', 'ENTROPY']);
export const VERIFIERS = Object.freeze(['cobol-fortran', 'node-openssl', 'anchor']);
export const LEDGER_REASONS = Object.freeze(['MAC-MISMATCH', 'RECORD-MISMATCH', 'CHAIN-BREAK', 'SEQ-GAP', 'FORMAT', 'HEAD-MISMATCH']);
export const VERDICTS = Object.freeze(['close', 'acceptable', 'marginal', 'nonconforming', 'insufficient']);
export const SEVERITIES = Object.freeze(['critical', 'high', 'medium', 'low', 'info']);
export const TAMPER_MODES = Object.freeze(['amount', 'record', 'delete', 'truncate']);
export const TAMPER_FILES = Object.freeze(['LEDGER.DAT', 'ACCEPTED.DAT', 'REJECTED.DAT']);

export class ApiError extends Error {
  constructor({ status = 0, code = 'NETWORK', message = '', field = null, index = null, retryAfter = null, layer = null } = {}) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
    this.index = index;
    this.retryAfter = retryAfter;
    this.layer = layer;
  }

  get network() {
    return this.status === 0;
  }
}

// ---------- typed projections ----------
const str = (v) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const int = (v, fallback = 0) => (Number.isInteger(v) ? v : fallback);
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {});
const bool = (v) => v === true;
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const hex = (v) => (typeof v === 'string' && /^[0-9a-f]*$/i.test(v) ? v.toLowerCase() : '');

/** Record<string, string | number> on a null-prototype object. */
function record(v) {
  const out = Object.create(null);
  for (const [key, value] of Object.entries(obj(v))) out[str(key)] = typeof value === 'number' && Number.isFinite(value) ? value : str(value);
  return out;
}

export function normalizeHealth(d) {
  const rt = obj(d.runtime);
  const st = obj(d.selftest);
  const lim = obj(d.limits);
  return {
    status: oneOf(d.status, ['ok', 'degraded'], 'degraded'),
    version: str(d.version),
    demo: bool(d.demo),
    runtime: { node: str(rt.node), cobol: str(rt.cobol), fortran: str(rt.fortran) },
    selftest: {
      status: oneOf(st.status, ['pass', 'fail'], 'fail'),
      checks: arr(st.checks).map((c) => ({
        name: str(obj(c).name),
        status: oneOf(obj(c).status, ['pass', 'fail'], 'fail'),
        detail: obj(c).detail === undefined || obj(c).detail === null ? null : str(obj(c).detail),
      })),
    },
    keySource: d.keySource === undefined ? null : str(d.keySource),
    limits: {
      maxTransactions: num(lim.maxTransactions, 1000),
      maxBodyBytes: num(lim.maxBodyBytes, 524288),
      jobTimeoutMs: num(lim.jobTimeoutMs, 10000),
      jobTtlMs: num(lim.jobTtlMs, 900000),
    },
  };
}

const INPUT_KEYS = ['id', 'timestamp', 'from', 'to', 'amount', 'currency', 'pan', 'channel', 'memo'];

export function normalizeSample(d) {
  return {
    seed: num(d.seed),
    transactions: arr(d.transactions).filter((t) => t && typeof t === 'object' && !Array.isArray(t)).map((t) => {
      const out = {};
      for (const key of INPUT_KEYS) if (typeof t[key] === 'string') out[key] = t[key];
      return out;
    }),
  };
}

export function normalizeVerification(d) {
  const v = obj(d);
  return {
    valid: bool(v.valid),
    entries: num(v.entries),
    head: v.head ? hex(v.head) : null,
    brokenAt: Number.isInteger(v.brokenAt) ? v.brokenAt : null,
    reason: v.reason === null || v.reason === undefined ? null : oneOf(v.reason, LEDGER_REASONS, str(v.reason)),
    verifiedBy: arr(v.verifiedBy).filter((x) => VERIFIERS.includes(x)),
    ms: num(v.ms),
  };
}

function normalizeEntry(e) {
  const x = obj(e);
  return {
    seq: int(x.seq),
    type: oneOf(x.type, ['A', 'R'], '?'),
    id: str(x.id),
    timestamp: str(x.timestamp),
    code: str(x.code),
    sign: oneOf(x.sign, ['+', '-', '?'], '?'),
    amountCents: str(x.amountCents),
    currency: str(x.currency),
    fromMasked: str(x.fromMasked),
    panLast4: str(x.panLast4),
    recordMac: hex(x.recordMac),
    prev: hex(x.prev),
    mac: hex(x.mac),
    raw: str(x.raw),
  };
}

function normalizeRisk(d) {
  const r = obj(d);
  const b = obj(r.benford);
  const a = obj(r.amounts);
  const hist = obj(a.histogram);
  const th = obj(r.thresholds);
  let edges = arr(hist.log10Edges).map((x) => num(x));
  let counts = arr(hist.counts).map((x) => num(x));
  if (edges.length !== counts.length + 1) {
    const n = Math.max(0, Math.min(counts.length, edges.length - 1));
    counts = counts.slice(0, n);
    edges = edges.slice(0, n + 1);
  }
  const nine = (list) => Array.from({ length: 9 }, (_, i) => num(arr(list)[i]));
  return {
    schema: str(r.schema),
    n: num(r.n),
    benford: {
      n: num(b.n),
      counts: nine(b.counts),
      observed: nine(b.observed),
      expected: nine(b.expected),
      chi2: num(b.chi2),
      pValue: num(b.pValue),
      mad: num(b.mad),
      verdict: oneOf(b.verdict, VERDICTS, 'insufficient'),
      verdictBasis: oneOf(b.verdictBasis, ['chi2', 'mad', 'none'], 'none'),
    },
    amounts: {
      medianCents: num(a.medianCents),
      madCents: num(a.madCents),
      minCents: num(a.minCents),
      maxCents: num(a.maxCents),
      histogram: { log10Edges: edges, counts },
    },
    thresholds: {
      z: num(th.z, 3.5),
      zScaleFloor: num(th.zScaleFloor, 0.25),
      structuring: arr(th.structuring).map((s) => ({ currency: str(obj(s).currency), lowCents: num(obj(s).lowCents), highCents: num(obj(s).highCents) })),
      velocityCount: num(th.velocityCount, 5),
      velocityWindowS: num(th.velocityWindowS, 600),
      entropyBits: num(th.entropyBits, 4),
      entropyMinLength: num(th.entropyMinLength, 20),
    },
    transactions: arr(r.transactions).map((t) => ({
      id: str(obj(t).id),
      score: num(obj(t).score),
      z: numOrNull(obj(t).z),
      entropy: numOrNull(obj(t).entropy),
      signals: arr(obj(t).signals).filter((s) => SIGNALS.includes(s)),
    })),
    flagged: num(r.flagged),
  };
}

export function normalizeJob(d) {
  const s = obj(d.summary);
  const l = obj(d.ledger);
  return {
    job: /^j-[0-9a-f]{24}$/.test(str(d.job)) ? str(d.job) : '',
    createdAt: str(d.createdAt),
    expiresAt: str(d.expiresAt),
    stages: arr(d.stages).map((x) => {
      const st = obj(x);
      return {
        name: str(st.name),
        status: oneOf(st.status, ['ok', 'warn', 'error'], 'warn'),
        ms: num(st.ms),
        rc: Number.isInteger(st.rc) ? st.rc : null,
        detail: record(st.detail),
      };
    }),
    summary: {
      received: num(s.received),
      accepted: num(s.accepted),
      rejected: num(s.rejected),
      flagged: num(s.flagged),
      totalsByCurrency: record(s.totalsByCurrency),
    },
    rejections: arr(d.rejections).map((x) => {
      const r = obj(x);
      return {
        line: int(r.line),
        id: str(r.id),
        legacyId: str(r.legacyId),
        code: str(r.code),
        field: str(r.field),
        detail: str(r.detail),
        message: str(r.message),
      };
    }),
    accepted: arr(d.accepted).map((x) => {
      const a = obj(x);
      return {
        id: str(a.id),
        timestamp: str(a.timestamp),
        fromToken: hex(a.fromToken),
        toToken: hex(a.toToken),
        fromMasked: str(a.fromMasked),
        toMasked: str(a.toMasked),
        amountCents: str(a.amountCents),
        currency: str(a.currency),
        channel: str(a.channel),
        panMasked: a.panMasked === null || a.panMasked === undefined || a.panMasked === '' ? null : str(a.panMasked),
        memo: str(a.memo),
      };
    }),
    risk: normalizeRisk(d.risk),
    ledger: {
      algorithm: str(l.algorithm),
      genesis: hex(l.genesis),
      head: hex(l.head),
      entries: arr(l.entries).map(normalizeEntry),
      verification: normalizeVerification(l.verification),
    },
  };
}

function normalizeTamper(d) {
  return {
    tampered: bool(d.tampered),
    seq: num(d.seq),
    mode: oneOf(d.mode, TAMPER_MODES, str(d.mode)),
    file: oneOf(d.file, TAMPER_FILES, 'LEDGER.DAT'),
    before: d.before === null || d.before === undefined ? null : str(d.before),
    after: d.after === null || d.after === undefined ? null : str(d.after),
  };
}

export function normalizePosture(d) {
  const sandbox = obj(d.sandbox);
  const build = obj(d.build);
  const deps = obj(d.dependencies);
  const compiler = (c) => ({ compiler: str(obj(c).compiler), flags: arr(obj(c).flags).map(str) });
  const sandboxOut = Object.create(null);
  for (const [key, value] of Object.entries(sandbox)) {
    sandboxOut[key] = typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : str(value);
  }
  return {
    headers: record(d.headers),
    sandbox: sandboxOut,
    build: { cobol: compiler(build.cobol), fortran: compiler(build.fortran) },
    dependencies: { runtime: num(deps.runtime, NaN), dev: num(deps.dev, NaN) },
  };
}

export function normalizeFinding(f) {
  const x = obj(f);
  return {
    ruleId: str(x.ruleId),
    severity: oneOf(x.severity, SEVERITIES, 'info'),
    title: str(x.title),
    message: str(x.message),
    line: Math.max(1, int(x.line, 1)),
    column: Math.max(1, int(x.column, 1)),
    endColumn: Math.max(1, int(x.endColumn, 1)),
    snippet: str(x.snippet),
    cwe: str(x.cwe),
    fix: str(x.fix),
    suppression: x.suppression ? { justification: str(obj(x.suppression).justification) } : null,
  };
}

export function normalizeFileResult(r) {
  const x = obj(r);
  return {
    file: str(x.file ?? x.filename ?? x.path),
    language: str(x.language),
    format: x.format === null || x.format === undefined ? null : str(x.format),
    findings: arr(x.findings).map(normalizeFinding),
    suppressed: arr(x.suppressed).map(normalizeFinding),
  };
}

export function normalizeReport(d) {
  const tool = obj(d.tool);
  return {
    generatedAt: str(d.generatedAt),
    tool: { name: str(tool.name), version: str(tool.version) },
    groups: arr(d.groups).map((g) => ({
      name: str(obj(g).name),
      results: arr(obj(g).results).map(normalizeFileResult),
    })),
  };
}

export function normalizeExamples(d) {
  return arr(d.examples).map((e) => {
    const x = obj(e);
    return {
      name: str(x.name),
      group: oneOf(x.group, ['vulnerable', 'hardened'], 'vulnerable'),
      language: oneOf(x.language, ['cobol', 'fortran'], 'unknown'),
      path: str(x.path),
      source: str(x.source),
    };
  });
}

// ---------- transport ----------
async function request(method, path, body) {
  const init = {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    headers: { accept: 'application/json' },
  };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError({ message: 'Gatehouse is unreachable' });
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = obj(obj(data).error);
    throw new ApiError({
      status: res.status,
      code: str(e.code) || `HTTP ${res.status}`,
      message: str(e.message) || res.statusText || 'Request failed',
      field: e.field === undefined || e.field === null ? null : str(e.field),
      index: Number.isInteger(e.index) ? e.index : null,
      retryAfter: Number(res.headers.get('retry-after')) || null,
      layer: str(e.layer) || null,
    });
  }
  if (data === null || typeof data !== 'object') {
    throw new ApiError({ status: res.status, code: 'BAD-RESPONSE', message: 'Gatehouse sent an unexpected response' });
  }
  return data;
}

const jobPath = (id) => `/api/jobs/${encodeURIComponent(id)}`;

export const api = {
  health: async () => normalizeHealth(await request('GET', '/api/health')),
  sample: async (size, seed) => normalizeSample(await request('GET', `/api/sample?size=${encodeURIComponent(size)}&seed=${encodeURIComponent(seed)}`)),
  batch: async (transactions) => normalizeJob(await request('POST', '/api/batch', { transactions })),
  job: async (id) => normalizeJob(await request('GET', jobPath(id))),
  verify: async (id) => normalizeVerification(await request('POST', `${jobPath(id)}/verify`, {})),
  tamper: async (id, seq, mode) => normalizeTamper(await request('POST', `${jobPath(id)}/tamper`, { seq, mode })),
  posture: async () => normalizePosture(await request('GET', '/api/posture')),
  watchtowerReport: async () => normalizeReport(await request('GET', '/api/watchtower/report')),
  watchtowerExamples: async () => normalizeExamples(await request('GET', '/api/watchtower/examples')),

  /** Response headers of this very page, for the Defenses live checks. */
  async pageHeaders() {
    const res = await fetch('/', { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
    const headers = Object.create(null);
    res.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    await res.arrayBuffer().catch(() => null);
    return { status: res.status, headers };
  },
};

// ---------- Siege ----------
let labPromise = null;
/** shared/lab.mjs: the same scenarios the gateway's test suite runs. */
export function loadLab() {
  labPromise ??= import('/shared/lab.mjs').catch((error) => {
    labPromise = null;
    throw error;
  });
  return labPromise;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * fetch for runScenario(): same-origin, no cache, and transparent back-off on
 * Gatehouse's rate limiter (P-RATE) or busy batch core (P-BUSY), so a full
 * siege never reports those as the layer that "contained" an attack.
 */
async function labFetch(url, init = {}) {
  let res = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    res = await fetch(url, { ...init, credentials: 'same-origin', cache: 'no-store', redirect: 'manual' });
    if (res.status !== 429 && res.status !== 503) return res;
    const body = await res.clone().json().catch(() => null);
    const code = obj(obj(body).error).code;
    if (code !== 'P-RATE' && code !== 'P-BUSY') return res;
    const wait = Number(res.headers.get('retry-after')) * 1000 || 300 * (attempt + 1);
    await sleep(Math.min(wait, 5000));
  }
  return res;
}

/** Run one Siege scenario against the live gateway via shared/lab.mjs. */
export async function launchScenario(scenario) {
  const lab = await loadLab();
  return lab.runScenario(scenario, { fetch: labFetch });
}
