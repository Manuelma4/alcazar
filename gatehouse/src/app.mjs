// SPDX-License-Identifier: Apache-2.0
// Gatehouse: the only door into the legacy batch core.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { ROOT, VERSION } from './config.mjs';
import {
  HttpError, checkHost, checkSameOrigin, readJsonBody, securityHeaders, sendError, sendJson,
} from './http.mjs';
import { JobStore } from './jobs.mjs';
import { Pipeline } from './pipeline.mjs';
import { RateLimiter } from './ratelimit.mjs';
import { RLIMITS_AVAILABLE, runLegacy } from './runner.mjs';
import { sampleBatch } from './sample.mjs';
import { validateBatch } from './schema.mjs';
import { loadStaticFiles } from './static.mjs';
import { buildWatchtowerReport } from './watchtower.mjs';

const JOB_PATH = /^\/api\/jobs\/(j-[0-9a-f]{24})(\/verify|\/tamper)?$/;
const STATIC_MOUNTS = [
  { dir: 'lookout', url: '/', exclude: ['dev', 'test', 'mock', 'README.md'] },
  { dir: 'shared', url: '/shared/' },
  { dir: 'watchtower/src', url: '/watchtower/src/' },
];

/**
 * Build the application. Nothing listens until `listen()` is called.
 * @param {ReturnType<import('./config.mjs').loadConfig>} config
 */
export async function createApp(config, { log = defaultLog } = {}) {
  await mkdir(config.workDir, { recursive: true, mode: 0o700 });
  const { key: masterKey, source: keySource } = await loadMasterKey(config.keyFile);
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
  const apiTokenDigest = config.apiToken ? sha256(config.apiToken) : null;
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
    limits: {
      maxTransactions: config.limits.maxTransactions,
      maxBodyBytes: config.limits.maxBodyBytes,
      jobTimeoutMs: config.limits.jobTimeoutMs,
      jobTtlMs: config.limits.jobTtlMs,
    },
  });

  const posture = async () => ({
    headers,
    sandbox: {
      shell: false,
      minimalEnv: true,
      secretsOnStdin: true,
      timeoutMs: config.limits.jobTimeoutMs,
      maxOutputBytes: config.limits.maxOutputBytes,
      rlimits: RLIMITS_AVAILABLE,
      permissionModel: typeof process.permission?.has === 'function',
    },
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

  function authorize(req) {
    if (!apiTokenDigest) return;
    const match = /^Bearer ([\x21-\x7e]{1,512})$/.exec(req.headers.authorization ?? '');
    // Compare digests so the comparison is constant-time and length-blind.
    if (!match || !timingSafeEqual(sha256(match[1]), apiTokenDigest)) {
      throw new HttpError(401, 'P-AUTH', 'Missing or invalid bearer token');
    }
  }

  async function postBatch(req, res) {
    requireBatchCore();
    if (running >= config.limits.maxConcurrentJobs) {
      throw new HttpError(503, 'P-BUSY', 'Too many batches in progress, retry shortly');
    }
    running += 1;
    try {
      const started = performance.now();
      const { value } = await readJsonBody(req, config.limits.maxBodyBytes);
      const transactions = validateBatch(value, config.limits.maxTransactions);
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
    if (!action) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed('GET');
      sendJson(res, 200, entry.job);
      return;
    }
    if (req.method !== 'POST') throw methodNotAllowed('POST');
    checkSameOrigin(req);
    requireBatchCore();
    const { value } = await readJsonBody(req, 4096);
    if (action === '/verify') {
      if (!isEmptyObject(value)) throw new HttpError(400, 'P-SCHEMA', 'verify takes an empty object');
      const verification = await pipeline.verify(entry.state);
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
    sendJson(res, 200, { tampered: true, seq, mode, before: changed.before, after: changed.after });
  }

  async function route(req, res) {
    // Origin-form targets only: "//host/path" would otherwise parse as a
    // network-path reference and smuggle a different authority.
    if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new HttpError(404, 'P-NOTFOUND', 'Not found');
    const url = new URL(req.url, 'http://gatehouse.invalid');
    const path = url.pathname;
    if (path.length > 512) throw new HttpError(414, 'P-NOTFOUND', 'Path too long');

    if (!path.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed('GET, HEAD');
      if (reloadStatic) await reloadStatic();
      serveStatic(req, res, path);
      return;
    }

    const client = config.trustProxy
      ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress
      : req.socket.remoteAddress;
    const rate = limiter.take(client ?? 'unknown');
    if (!rate.allowed) throw new HttpError(429, 'P-RATE', 'Too many requests', { retryAfter: rate.retryAfterS });

    if (path === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw methodNotAllowed('GET');
      sendJson(res, 200, health());
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
        path: (req.url ?? '').split('?')[0].slice(0, 120),
        status: res.statusCode,
        ms: Math.round(performance.now() - started),
      });
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return {
    server,
    health,
    listen: () => new Promise((resolve) => server.listen(config.port, config.host, () => resolve(server.address()))),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      server.closeAllConnections?.();
      await jobs.close();
      pipeline.wipe();
    },
  };
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
  if (!['amount', 'delete', 'truncate'].includes(value.mode)) {
    throw new HttpError(400, 'P-SCHEMA', '"mode" must be amount, delete or truncate', { field: 'mode' });
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

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest();
}

function compilerName(line, pattern, label) {
  const match = typeof line === 'string' ? pattern.exec(line) : null;
  return match ? `${label} ${match[1]}` : 'unknown';
}

/**
 * The 256-bit master key: from a file readable only by its owner (like an
 * SSH private key), or generated per process when none is configured.
 */
async function loadMasterKey(file) {
  if (!file) return { key: randomBytes(32), source: 'generated' };
  const info = await stat(file);
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw new Error(`${file} must not be accessible by group or others (chmod 600)`);
  }
  const text = (await readFile(file, 'utf8')).trim();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Error(`${file} must contain 64 lower-case hex digits`);
  return { key: Buffer.from(text, 'hex'), source: 'file' };
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
