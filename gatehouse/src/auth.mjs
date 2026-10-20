// SPDX-License-Identifier: Apache-2.0
// Operator authentication. There is one operator token: read from a file
// (like the master key), from the environment, or — when neither is set —
// generated for this run and printed once as a sign-in link. Scripts send it
// as a bearer token; Lookout trades it for a session cookie (HttpOnly,
// SameSite=Strict), so no script in the page ever holds a credential.
// Gatehouse keeps digests only: of the token, and of every session id.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;
const MIN_TOKEN = 32;
const MAX_TOKEN = 512;

const digest = (value) => createHash('sha256').update(value).digest();

/** An address only this machine can reach. */
export function isLoopback(host) {
  return host === 'localhost' || host === '::1' || /^127(\.\d{1,3}){3}$/.test(host);
}

/** 32 to 512 printable ASCII characters, no spaces. */
function validToken(bytes) {
  if (bytes.length < MIN_TOKEN || bytes.length > MAX_TOKEN) return false;
  for (const byte of bytes) if (byte < 0x21 || byte > 0x7e) return false;
  return true;
}

/**
 * The operator token's digest and where it came from. `signIn` is set only
 * for a generated token: the one time it exists as text, to be printed.
 * @param {ReturnType<import('./config.mjs').loadConfig>} config
 */
export async function loadOperatorToken(config) {
  if (config.auth === 'none') {
    if (config.apiToken || config.apiTokenFile) throw new Error('ALCAZAR_AUTH=none cannot be combined with an operator token');
    if (!isLoopback(config.host)) {
      throw new Error(`ALCAZAR_AUTH=none is refused on ${config.host}: without authentication Gatehouse listens on a loopback address only`);
    }
    return { digest: null, source: 'none', signIn: null };
  }
  if (config.apiToken && config.apiTokenFile) throw new Error('Set ALCAZAR_API_TOKEN or ALCAZAR_API_TOKEN_FILE, not both');
  const shape = `${MIN_TOKEN} to ${MAX_TOKEN} printable ASCII characters, without spaces`;
  if (config.apiTokenFile) {
    const info = await stat(config.apiTokenFile);
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
      throw new Error(`${config.apiTokenFile} must not be accessible by group or others (chmod 600)`);
    }
    // Bytes from start to finish, wiped once hashed.
    const raw = await readFile(config.apiTokenFile);
    try {
      let end = raw.length;
      while (end > 0 && (raw[end - 1] === 0x0a || raw[end - 1] === 0x0d)) end -= 1;
      if (!validToken(raw.subarray(0, end))) throw new Error(`${config.apiTokenFile} must hold the operator token: ${shape}`);
      return { digest: digest(raw.subarray(0, end)), source: 'file', signIn: null };
    } finally {
      raw.fill(0);
    }
  }
  if (config.apiToken) {
    if (/[^\x21-\x7e]/.test(config.apiToken) || !validToken(Buffer.from(config.apiToken, 'ascii'))) {
      throw new Error(`ALCAZAR_API_TOKEN must be ${shape}`);
    }
    return { digest: digest(config.apiToken), source: 'environment', signIn: null };
  }
  const generated = randomBytes(24).toString('base64url');
  return { digest: digest(generated), source: 'generated', signIn: generated };
}

/** Constant-time and length-blind: digests are compared, never the tokens. */
export function tokenMatches(candidate, expected) {
  return typeof candidate === 'string' && candidate.length <= MAX_TOKEN && timingSafeEqual(digest(candidate), expected);
}

/** Browser sessions, in memory: a restart signs everybody out. */
export class Sessions {
  constructor({ ttlMs = 8 * 60 * 60 * 1000, max = 64, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
    /** @type {Map<string, number>} session id digest -> expiry */
    this.expiries = new Map();
  }

  /** A new session. Its id goes to the browser; only its digest stays here. */
  create() {
    this.prune();
    while (this.expiries.size >= this.max) this.expiries.delete(this.expiries.keys().next().value);
    const id = randomBytes(32).toString('base64url');
    const expires = this.now() + this.ttlMs;
    this.expiries.set(digest(id).toString('hex'), expires);
    return { id, expires };
  }

  valid(id) {
    if (typeof id !== 'string' || !SESSION_ID.test(id)) return false;
    const key = digest(id).toString('hex');
    const expires = this.expiries.get(key);
    if (expires === undefined) return false;
    if (expires <= this.now()) {
      this.expiries.delete(key);
      return false;
    }
    return true;
  }

  revoke(id) {
    if (typeof id === 'string' && SESSION_ID.test(id)) this.expiries.delete(digest(id).toString('hex'));
  }

  prune() {
    const now = this.now();
    for (const [key, expires] of this.expiries) if (expires <= now) this.expiries.delete(key);
  }

  clear() {
    this.expiries.clear();
  }
}

/** Over TLS the cookie is `__Host-` prefixed and Secure: pinned to this host, never sent in clear. */
export function sessionCookieName(secure) {
  return secure ? '__Host-alz_session' : 'alz_session';
}

export function readCookie(header, name) {
  if (typeof header !== 'string' || header.length > 8192) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function sessionCookie(name, value, maxAgeS, secure) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`;
}
