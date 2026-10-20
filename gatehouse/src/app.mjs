// SPDX-License-Identifier: Apache-2.0
// Gatehouse: the only door into the legacy batch core.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { STATUS_CODES, createServer } from 'node:http';
import { join, sep } from 'node:path';
import {
  Sessions, loadOperatorToken, readCookies, sessionCookie, sessionCookieName, tokenMatches,
} from './auth.mjs';
import { ROOT, VERSION } from './config.mjs';
import {
  HttpError, checkHost, checkSameOrigin, readJsonBody, securityHeaders, sendError, sendJson,
} from './http.mjs';
import { JobStore } from './jobs.mjs';
import { keyFromHex } from './ledger.mjs';
import { Pipeline } from './pipeline.mjs';
import { RateLimiter } from './ratelimit.mjs';
import { RLIMITS_AVAILABLE, runLegacy } from './runner.mjs';
import { sampleBatch } from './sample.mjs';
import { validateBatch } from './schema.mjs';
import { loadStaticFiles } from './static.mjs';
import { buildWatchtowerReport } from './watchtower.mjs';

const JOB_PATH = /^\/api\/jobs\/(j-[0-9a-f]{24})(\/verify|\/tamper|\/anchor)?$/;
const STATIC_MOUNTS = [
  { dir: 'lookout', url: '/', exclude: ['dev', 'test', 'mock', 'README.md'] },
  { dir: 'shared', url: '/shared/' },
  // The browser-safe analyzer only: src/node/ needs Node.js APIs.
  { dir: 'watchtower/src', url: '/watchtower/src/', exclude: ['node'] },
];

/**
 * Build the application. Nothing listens until `listen()` is called.
 * @param {ReturnType<import('./config.mjs').loadConfig>} config
 */
export async function createApp(config, { log = defaultLog } = {}) {
  const operator = await loadOperatorToken(config);
  await prepareWorkDir(config.workDir);
  if (config.apiTokenFile) await refuseInsideWorkDir(config.apiTokenFile, config.workDir, 'ALCAZAR_API_TOKEN_FILE');
  await reapOrphans(config.workDir, log);
  const { key: masterKey, source: keySource } = await loadMasterKey(config.keyFile, config.workDir);
  if (config.evidenceDir) {
    // A key generated per run dies with the process, and with it K_ledger
    // and the anchor key: nobody could ever check that evidence.
    if (!config.keyFile) throw new Error('ALCAZAR_EVIDENCE_DIR needs ALCAZAR_KEY_FILE: evidence sealed with a key generated per run could never be verified');
    await prepareEvidenceDir(config.evidenceDir, config.workDir);
  }
  const pipeline = new Pipeline({ config, masterKey });
  masterKey.fill(0);

  const manifest = await readManifest(join(ROOT, 'build', 'manifest.json'));
  let files = await loadStaticFiles(ROOT, STATIC_MOUNTS);
  // Development only: re-read the static files on every page request.
  const reloadStatic = config.staticReload ? async () => { files = await loadStaticFiles(ROOT, STATIC_MOUNTS); } : null;
  const watchtower = await buildWatchtowerReport(ROOT);
  const jobs = new JobStore({ maxJobs: config.limits.maxJobs, ttlMs: config.limits.jobTtlMs });
  const limiter = new RateLimiter({
    capacity: config.limits.rateCapacity,
    refillPerSecond: config.limits.rateRefillPerSecond,
  });
  const selftest = await powerOnSelfTest(config, pipeline);
  if (selftest.status !== 'pass') log('error', 'self-test failed: batch endpoints are disabled', { checks: selftest.checks });

  const headers = securityHeaders({ hsts: config.hsts });
  const sessions = new Sessions();
  // Over TLS (HSTS on) the session cookie is __Host- prefixed and Secure.
  const cookieName = sessionCookieName(config.hsts);
  let running = 0;

  const health = () => ({
    status: selftest.status === 'pass' ? 'ok' : 'degraded',
    version: VERSION,
    demo: config.demo,
    runtime: {
      node: process.version,
      cobol: compilerName(manifest?.cobol?.compiler, /GnuCOBOL\)?\s*([\d.]+)/, 'GnuCOBOL'),
      fortran: compilerName(manifest?.fortran?.compiler, /([\d.]+)\s*$/, 'GNU Fortran'),
    },
    selftest,
    keySource,
    auth: config.auth,
    // Public by nature: it verifies anchors and cannot sign them.
    anchorKey: { algorithm: 'Ed25519', publicKey: pipeline.signer.publicKey, keyId: pipeline.signer.keyId },
    limits: {
      maxTransactions: config.limits.maxTransactions,
      maxBodyBytes: config.limits.maxBodyBytes,
      jobTimeoutMs: config.limits.jobTimeoutMs,
      jobTtlMs: config.limits.jobTtlMs,
      maxJobs: config.limits.maxJobs,
    },
  });

  const posture = async () => ({
    headers,
    sandbox: {
      shell: false,
      minimalEnv: true,
      secretsOnStdin: true,
      verifiedBytes: true,
      outputMatchesInput: true,
      timeoutMs: config.limits.jobTimeoutMs,
      maxOutputBytes: config.limits.maxOutputBytes,
      rlimits: RLIMITS_AVAILABLE,
      permissionModel: typeof process.permission?.has === 'function',
    },
    evidence: { signedAnchors: true, exported: Boolean(config.evidenceDir) },
    build: {
      cobol: manifest?.cobol ?? { compiler: 'unknown', flags: [] },
      fortran: manifest?.fortran ?? { compiler: 'unknown', flags: [] },
    },
    dependencies: manifest?.dependencies ?? (await countDependencies()),
  });
  const postureCache = await posture();

  function requireBatchCore() {
    if (selftest.status !== 'pass') {
      throw new HttpError(503, 'P-LEGACY', 'The batch core failed its power-on self-test');
    }
  }

  /** Who is calling: the operator's bearer token, a Lookout session, or nobody (401). */
  function authorize(req) {
    if (!operator.digest) return 'none';
    const header = req.headers.authorization;
    if (header !== undefined) {
      const match = /^Bearer ([\x21-\x7e]{1,512})$/.exec(header);
      if (match && tokenMatches(match[1], operator.digest)) return 'bearer';
      throw new HttpError(401, 'P-AUTH', 'Invalid bearer token');
    }
    if (readCookies(req.headers.cookie, cookieName).some((id) => sessions.valid(id))) return 'session';
    throw new HttpError(401, 'P-AUTH', 'Sign in first: the API needs the operator token or a Lookout session');
  }

  /** GET: am I signed in? POST {token}: sign in (a session cookie). DELETE: sign out. */
  async function sessionEndpoint(req, res) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      sendJson(res, 200, { auth: config.auth, via: authorize(req) });
      return;
    }
    if (req.method === 'DELETE') {
      checkSameOrigin(req);
      for (const id of readCookies(req.headers.cookie, cookieName)) sessions.revoke(id);
      sendJson(res, 200, { auth: config.auth, via: null }, { 'set-cookie': sessionCookie(cookieName, '', 0, config.hsts) });
      return;
    }
    if (req.method !== 'POST') throw methodNotAllowed('GET, POST, DELETE');
    checkSameOrigin(req);
    const { value } = await readJsonBody(req, 1024);
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1 ||
        typeof value.token !== 'string') {
      throw new HttpError(400, 'P-SCHEMA', 'Sign-in takes {"token": "…"}', { field: 'token' });
    }
    if (!operator.digest) {
      sendJson(res, 200, { auth: config.auth, via: 'none' });
      return;
    }
    if (!tokenMatches(value.token, operator.digest)) throw new HttpError(401, 'P-AUTH', 'That operator token is not valid');
    const session = sessions.create();
    sendJson(res, 200, { auth: config.auth, via: 'session', expiresAt: new Date(session.expires).toISOString() }, {
      'set-cookie': sessionCookie(cookieName, session.id, Math.floor(sessions.ttlMs / 1000), config.hsts),
    });
  }

  async function postBatch(req, res) {
    requireBatchCore();
    // The body is read and validated before a batch slot is taken, so slow
    // or stalled uploads cannot hold the batch core hostage.
    const started = performance.now();
    const { value } = await readJsonBody(req, config.limits.maxBodyBytes);
    const transactions = validateBatch(value, config.limits.maxTransactions);
    if (running >= config.limits.maxConcurrentJobs) {
      throw new HttpError(503, 'P-BUSY', 'Too many batches in progress, retry shortly');
    }
    running += 1;
    try {
      const { job, state } = await pipeline.run(transactions, { validationMs: performance.now() - started });
      jobs.add(job, state);
      sendJson(res, 200, job);
    } finally {
      running -= 1;
    }
  }

  async function jobAction(req, res, id, action) {
    const entry = jobs.get(id);
    if (!entry) throw new HttpError(404, 'P-NOTFOUND', 'No such job (jobs expire after 15 minutes)');
    if (!action || action === '/anchor') {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed('GET');
      if (action) sendJson(res, 200, entry.job.ledger.anchor, { 'content-disposition': `attachment; filename="${id}.anchor.json"` });
      else sendJson(res, 200, entry.job);
      return;
    }
    if (req.method !== 'POST') throw methodNotAllowed('POST');
    checkSameOrigin(req);
    requireBatchCore();
    const { value } = await readJsonBody(req, 4096);
    // Pinned while its files are in use: eviction picks another job.
    entry.busy += 1;
    try {
      await jobCommand(res, entry, action, value);
    } finally {
      entry.busy -= 1;
    }
  }

  async function jobCommand(res, entry, action, value) {
    if (action === '/verify') {
      if (!isEmptyObject(value)) throw new HttpError(400, 'P-SCHEMA', 'verify takes an empty object');
      let verification;
      try {
        verification = await pipeline.verify(entry.state);
      } catch (error) {
        // A verification that did not complete proves nothing: the job must
        // stop showing its last "valid" — whatever failed (a verifier, a
        // timeout, an unreadable file). Only a busy gate is not about the job.
        if (!(error instanceof HttpError && error.code === 'P-BUSY')) {
          entry.job.ledger.verification = { valid: false, entries: 0, head: null, brokenAt: null, reason: null, verifiedBy: [], ms: 0 };
        }
        throw error;
      }
      entry.job.ledger.verification = verification;
      sendJson(res, 200, verification);
      return;
    }
    if (!config.demo) throw new HttpError(403, 'P-DEMO', 'Tampering is only available in demo mode');
    const { seq, mode } = validateTamper(value);
    let changed;
    try {
      changed = await pipeline.tamper(entry.state, seq, mode);
    } catch (error) {
      if (error instanceof RangeError) throw new HttpError(400, 'P-SCHEMA', error.message, { field: 'seq' });
      throw error;
    }
    entry.job.ledger.entries = changed.entries;
    sendJson(res, 200, { tampered: true, seq, mode, file: changed.file, before: changed.before, after: changed.after });
  }

  async function route(req, res) {
    // Origin-form targets only: "//host/path" would otherwise parse as a
    // network-path reference and smuggle a different authority.
    // A backslash is turned into "/" by URL parsing after this check, so
    // "/\host" would smuggle an authority too: no target may contain one.
    if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) {
      throw new HttpError(404, 'P-NOTFOUND', 'Not found');
    }
    const url = new URL(req.url, 'http://gatehouse.invalid');
    const path = url.pathname;
    if (path.length > 512) throw new HttpError(414, 'P-NOTFOUND', 'Path too long');

    if (!path.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed('GET, HEAD');
      if (reloadStatic) await reloadStatic();
      serveStatic(req, res, path);
      return;
    }

    const client = clientAddress(req, config.trustProxyHops);
    const rate = limiter.take(client ?? 'unknown');
    if (!rate.allowed) throw new HttpError(429, 'P-RATE', 'Too many requests', { retryAfter: rate.retryAfterS });

    if (path === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed('GET');
      sendJson(res, 200, health());
      return;
    }
    if (path === '/api/session') {
      await sessionEndpoint(req, res);
      return;
    }
    authorize(req);

    if (path === '/api/batch') {
      if (req.method !== 'POST') throw methodNotAllowed('POST');
      checkSameOrigin(req);
      await postBatch(req, res);
      return;
    }
    const job = JOB_PATH.exec(path);
    if (job) {
      await jobAction(req, res, job[1], job[2]);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed('GET');
    switch (path) {
      case '/api/sample': {
        const size = boundedInt(url.searchParams.get('size'), 200, 1, config.limits.maxTransactions, 'size');
        const seed = boundedInt(url.searchParams.get('seed'), 42, 0, 2 ** 31 - 1, 'seed');
        sendJson(res, 200, sampleBatch({ size, seed }));
        return;
      }
      case '/api/posture':
        sendJson(res, 200, postureCache);
        return;
      case '/api/watchtower/report':
      case '/api/watchtower/examples':
        if (!watchtower) throw new HttpError(503, 'P-UNAVAILABLE', 'Watchtower is not installed');
        sendJson(res, 200, path.endsWith('report') ? watchtower.report : { examples: watchtower.examples });
        return;
      default:
        throw new HttpError(404, 'P-NOTFOUND', 'No such endpoint');
    }
  }

  function serveStatic(req, res, path) {
    const file = files.get(path);
    if (!file) throw new HttpError(404, 'P-NOTFOUND', 'Not found');
    if (req.headers['if-none-match'] === file.etag) {
      res.writeHead(304, { etag: file.etag, 'cache-control': 'no-cache' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': file.type,
      'content-length': file.body.length,
      'cache-control': 'no-cache',
      etag: file.etag,
    });
    res.end(req.method === 'HEAD' ? undefined : file.body);
  }

  const server = createServer(async (req, res) => {
    const started = performance.now();
    // Set first, so every response carries them, errors included.
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    try {
      checkHost(req, config.allowedHosts);
      await route(req, res);
    } catch (error) {
      if (error instanceof HttpError) {
        if (!res.headersSent) sendError(res, error);
      } else {
        log('error', 'unhandled error', { message: String(error?.message ?? error) });
        if (!res.headersSent) sendError(res, new HttpError(500, 'P-INTERNAL', 'Internal error'));
      }
    } finally {
      log('info', 'request', {
        method: req.method,
        // A job id is a capability: logs keep four hex digits, enough to
        // follow one job, not to reach it.
        path: (req.url ?? '').split('?')[0].slice(0, 120).replace(/j-([0-9a-f]{4})[0-9a-f]{20}/g, 'j-$1…'),
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  // Requests the HTTP parser refuses never reach the handler above: answer
  // them with the right status (timeouts and oversized headers included) and
  // log the reason, so they are never silent.
  server.on('clientError', (error, socket) => {
    const code = String(error?.code ?? 'UNKNOWN').slice(0, 40);
    if (code === 'ECONNRESET' || !socket.writable) {
      socket.destroy();
      return;
    }
    const status = code === 'ERR_HTTP_REQUEST_TIMEOUT' ? 408 : code === 'HPE_HEADER_OVERFLOW' ? 431 : 400;
    log('warn', 'client error', { code, status });
    // The security headers too: every response carries them, even these.
    const lines = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('');
    socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\n${lines}Connection: close\r\nContent-Length: 0\r\n\r\n`);
  });

  return {
    server,
    health,
    // A generated operator token, for the one sign-in link printed at start.
    signIn: operator.signIn,
    listen: () => new Promise((resolve) => server.listen(config.port, config.host, () => resolve(server.address()))),
    async close() {
      // Stop accepting, drop idle keep-alive sockets now, and give requests
      // in flight a few seconds before cutting them: shutdown is bounded.
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeIdleConnections?.();
      const deadline = setTimeout(() => server.closeAllConnections?.(), 3000);
      await closed;
      clearTimeout(deadline);
      await jobs.close();
      sessions.clear();
      pipeline.wipe();
    },
  };
}

/**
 * The client address for rate limiting. Behind N trusted proxies that each
 * append to X-Forwarded-For, the client is the N-th entry from the right;
 * everything to its left was written by the client and is never trusted.
 */
function clientAddress(req, hops) {
  if (hops > 0) {
    const entries = String(req.headers['x-forwarded-for'] ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    if (entries.length >= hops) return entries[entries.length - hops];
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Gatehouse owns its work directory: job directories left by a crash are
 * removed at start-up.
 */
async function reapOrphans(workDir, log) {
  const entries = await readdir(workDir, { withFileTypes: true });
  const orphans = entries.filter((e) => e.isDirectory() && /^job-/.test(e.name));
  await Promise.all(orphans.map((e) => rm(join(workDir, e.name), { recursive: true, force: true })));
  if (orphans.length) log('warn', 'removed job directories left by a previous run', { count: orphans.length });
}

function methodNotAllowed(allow) {
  return new HttpError(405, 'P-METHOD', 'Method not allowed', { allow });
}

function isEmptyObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

function validateTamper(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HttpError(400, 'P-SCHEMA', 'Body must be an object');
  }
  for (const key of Object.keys(value)) {
    if (key !== 'seq' && key !== 'mode') throw new HttpError(400, 'P-SCHEMA', 'Unknown key', { field: key.slice(0, 40) });
  }
  if (!Number.isInteger(value.seq) || value.seq < 1 || value.seq > 1000) {
    throw new HttpError(400, 'P-SCHEMA', '"seq" must be an integer between 1 and 1000', { field: 'seq' });
  }
  if (!['amount', 'delete', 'truncate', 'record'].includes(value.mode)) {
    throw new HttpError(400, 'P-SCHEMA', '"mode" must be amount, delete, truncate or record', { field: 'mode' });
  }
  return { seq: value.seq, mode: value.mode };
}

function boundedInt(text, fallback, min, max, name) {
  if (text === null) return fallback;
  if (!/^\d{1,10}$/.test(text) || Number(text) < min || Number(text) > max) {
    throw new HttpError(400, 'P-SCHEMA', `"${name}" must be an integer between ${min} and ${max}`, { field: name });
  }
  return Number(text);
}

function compilerName(line, pattern, label) {
  const match = typeof line === 'string' ? pattern.exec(line) : null;
  return match ? `${label} ${match[1]}` : 'unknown';
}

/**
 * The 256-bit master key: from a file readable only by its owner (like an
 * SSH private key), or generated per process when none is configured. Never
 * from inside the job directory, the insider's territory.
 */
async function loadMasterKey(file, workDir) {
  if (!file) return { key: randomBytes(32), source: 'generated' };
  const info = await stat(file);
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw new Error(`${file} must not be accessible by group or others (chmod 600)`);
  }
  await refuseInsideWorkDir(file, workDir, 'The master key');
  // Bytes from start to finish: a hex string could never be wiped.
  const raw = await readFile(file);
  try {
    let end = raw.length;
    while (end > 0 && (raw[end - 1] === 0x0a || raw[end - 1] === 0x0d)) end -= 1;
    const key = keyFromHex(raw.subarray(0, end));
    if (!key) throw new Error(`${file} must contain 64 lower-case hex digits`);
    return { key, source: 'file' };
  } finally {
    raw.fill(0);
  }
}

/**
 * The work directory must be Gatehouse's alone — this user's, mode 0700 —
 * since leftover job directories in it are deleted at start-up: pointed at
 * a shared directory such as /tmp, that would delete other software's.
 */
async function prepareWorkDir(workDir) {
  await mkdir(workDir, { recursive: true, mode: 0o700 });
  const info = await stat(workDir);
  const owner = typeof process.getuid === 'function' ? process.getuid() : info.uid;
  if (process.platform !== 'win32' && ((info.mode & 0o077) !== 0 || info.uid !== owner)) {
    throw new Error(`ALCAZAR_WORK_DIR (${workDir}) must be a private directory: owned by this user, mode 0700`);
  }
}

/** A secret file is never kept in the job directory, the insider's territory. */
async function refuseInsideWorkDir(file, workDir, what) {
  const [real, work] = await Promise.all([realpath(file), realpath(workDir)]);
  if (real.startsWith(work + sep)) {
    throw new Error(`${what} (${file}) is inside the job directory (ALCAZAR_WORK_DIR): keep it elsewhere, e.g. on a read-only secret mount`);
  }
}

/** The evidence directory: private, and never inside the job directory (the insider's territory). */
async function prepareEvidenceDir(evidenceDir, workDir) {
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  const [evidence, work] = await Promise.all([realpath(evidenceDir), realpath(workDir)]);
  if (evidence === work || evidence.startsWith(work + sep) || work.startsWith(evidence + sep)) {
    throw new Error('ALCAZAR_EVIDENCE_DIR and ALCAZAR_WORK_DIR must not contain one another');
  }
  const info = await stat(evidence);
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw new Error(`${evidenceDir} must not be accessible by group or others (chmod 700)`);
  }
}

async function readManifest(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function countDependencies() {
  try {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    return {
      runtime: Object.keys(pkg.dependencies ?? {}).length,
      dev: Object.keys(pkg.devDependencies ?? {}).length,
    };
  } catch {
    return { runtime: 0, dev: 0 };
  }
}

/**
 * Power-on self-test: the Fortran kernel's known-answer tests, then a
 * two-transfer batch through the real pipeline whose ledger and account
 * tokens must match the Node.js / OpenSSL implementation bit for bit.
 */
async function powerOnSelfTest(config, pipeline) {
  const checks = [];
  try {
    const kat = await runLegacy(join(config.binDir, 'alzselftest'), [], {
      cwd: config.workDir,
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    });
    const parsed = kat.code === 0 ? JSON.parse(kat.stdout) : { checks: [] };
    for (const check of parsed.checks ?? []) {
      checks.push({ name: String(check.name), status: check.status === 'pass' ? 'pass' : 'fail' });
    }
    if (kat.code !== 0 || checks.length === 0) checks.push({ name: 'kernel-known-answers', status: 'fail' });
  } catch {
    checks.push({ name: 'kernel-known-answers', status: 'fail', detail: 'alzselftest could not run' });
  }

  const probe = [
    { id: 'POST-1', timestamp: '20251020101500', from: 'FR7630006000011234567890189', to: 'DE89370400440532013000',
      amount: '1.00', currency: 'EUR', pan: '', channel: 'API', memo: 'Power-on self-test' },
    { id: 'POST-2', timestamp: '20251020101501', from: 'DE89370400440532013000', to: 'FR7630006000011234567890189',
      amount: '-1.00', currency: 'EUR', pan: '', channel: 'API', memo: '' },
  ];
  try {
    const { job, state } = await pipeline.run(probe, { validationMs: 0 });
    const tokensMatch = job.accepted.length === 1 && job.accepted[0].fromToken === pipeline.token(probe[0].from);
    const sealed = job.ledger.verification.valid && job.ledger.verification.verifiedBy.length === 3;
    const judged = job.rejections.length === 1 && job.rejections[0].code === 'E403';
    checks.push({ name: 'cobol-validation', status: judged ? 'pass' : 'fail' });
    checks.push({ name: 'ledger-cross-check-openssl', status: sealed ? 'pass' : 'fail' });
    checks.push({ name: 'token-cross-check-openssl', status: tokensMatch ? 'pass' : 'fail' });
    await rm(state.dir, { recursive: true, force: true });
  } catch (error) {
    checks.push({ name: 'pipeline', status: 'fail', detail: String(error?.message ?? error).slice(0, 120) });
  }
  return { status: checks.every((c) => c.status === 'pass') ? 'pass' : 'fail', checks };
}

function defaultLog(level, message, fields = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, message, ...fields })}\n`);
}
