// SPDX-License-Identifier: Apache-2.0
// Gatehouse configuration. Every value comes from the environment, is
// validated once at start-up, and is frozen.

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const VERSION = '0.1.0';

/**
 * @param {Record<string, string | undefined>} [env]
 */
export function loadConfig(env = process.env) {
  const port = integer(env.ALCAZAR_PORT ?? '8080', 0, 65535, 'ALCAZAR_PORT');
  return Object.freeze({
    host: env.ALCAZAR_HOST ?? '127.0.0.1',
    port,
    binDir: resolve(env.ALCAZAR_BIN_DIR ?? join(ROOT, 'build', 'bin')),
    workDir: resolve(env.ALCAZAR_WORK_DIR ?? join(ROOT, 'var', 'jobs')),
    keyFile: env.ALCAZAR_KEY_FILE ? resolve(env.ALCAZAR_KEY_FILE) : null,
    // Every API call but /api/health needs the operator: `token` (generated
    // per run unless one is configured) or, on a loopback address only, `none`.
    auth: oneOf(env.ALCAZAR_AUTH ?? 'token', ['token', 'none'], 'ALCAZAR_AUTH'),
    apiToken: env.ALCAZAR_API_TOKEN || null,
    apiTokenFile: env.ALCAZAR_API_TOKEN_FILE ? resolve(env.ALCAZAR_API_TOKEN_FILE) : null,
    // Where each sealed job's files and signed anchor are kept (WORM storage
    // in production); without it they live as long as the job (15 minutes).
    evidenceDir: env.ALCAZAR_EVIDENCE_DIR ? resolve(env.ALCAZAR_EVIDENCE_DIR) : null,
    // Demo mode enables the ledger tamper endpoint used by the Siege lab.
    demo: (env.ALCAZAR_DEMO ?? '0') === '1',
    hsts: env.ALCAZAR_HSTS === '1',
    staticReload: env.ALCAZAR_STATIC_RELOAD === '1',
    // Number of trusted reverse proxies in front of Gatehouse (0 = none).
    trustProxyHops: integer(env.ALCAZAR_TRUST_PROXY ?? '0', 0, 10, 'ALCAZAR_TRUST_PROXY'),
    // Extra host names accepted in the Host header, besides localhost.
    allowedHosts: Object.freeze(
      (env.ALCAZAR_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    ),
    limits: Object.freeze({
      maxTransactions: 1000,
      maxBodyBytes: 512 * 1024,
      jobTimeoutMs: integer(env.ALCAZAR_JOB_TIMEOUT_MS ?? '10000', 1000, 120000, 'ALCAZAR_JOB_TIMEOUT_MS'),
      jobTtlMs: 15 * 60 * 1000,
      // Room for a full Siege (~23 small jobs) without evicting the user's
      // batch; bounded, and well within a 64 MB tmpfs.
      maxJobs: 40,
      maxConcurrentJobs: 2,
      // Legacy processes running at once across every request path, and
      // how many more may wait for a slot before callers get 503.
      maxProcesses: integer(env.ALCAZAR_MAX_PROCESSES ?? '4', 1, 64, 'ALCAZAR_MAX_PROCESSES'),
      processQueue: integer(env.ALCAZAR_PROCESS_QUEUE ?? '32', 0, 1000, 'ALCAZAR_PROCESS_QUEUE'),
      maxOutputBytes: 4 * 1024 * 1024,
      rateCapacity: integer(env.ALCAZAR_RATE_CAPACITY ?? '120', 1, 100000, 'ALCAZAR_RATE_CAPACITY'),
      rateRefillPerSecond: integer(env.ALCAZAR_RATE_REFILL ?? '2', 1, 100000, 'ALCAZAR_RATE_REFILL'),
    }),
  });
}

function integer(text, min, max, name) {
  if (!/^\d{1,9}$/.test(text)) throw new Error(`${name} must be an integer`);
  const value = Number(text);
  if (value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return value;
}

function oneOf(text, allowed, name) {
  if (!allowed.includes(text)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
  return text;
}
