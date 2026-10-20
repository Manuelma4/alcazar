// SPDX-License-Identifier: Apache-2.0
// HTTP plumbing: security headers, JSON responses, bounded body reading and
// same-origin enforcement.

export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
].join('; ');

/** Headers sent with every response. */
export function securityHeaders({ hsts = false } = {}) {
  const headers = {
    'content-security-policy': CSP,
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
    'origin-agent-cluster': '?1',
    'permissions-policy':
      'accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), ' +
      'magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-dns-prefetch-control': 'off',
    'x-frame-options': 'DENY',
    'x-permitted-cross-domain-policies': 'none',
  };
  if (hsts) headers['strict-transport-security'] = 'max-age=63072000; includeSubDomains';
  return headers;
}

/** An error that is safe to show to the client. */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} code   Gatehouse error code (P-*)
   * @param {string} message
   * @param {{ field?: string, index?: number, [key: string]: unknown }} [extra]
   */
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(res.req?.method === 'HEAD' ? undefined : body);
}

export function sendError(res, error) {
  const headers = error.status === 429 ? { 'retry-after': String(error.extra.retryAfter ?? 1) } : {};
  if (error.status === 413) headers.connection = 'close';
  if (error.status === 405 && error.extra.allow) headers.allow = error.extra.allow;
  if (error.status === 401) headers['www-authenticate'] = 'Bearer realm="Gatehouse"';
  const { retryAfter, ...extra } = error.extra;
  sendJson(res, error.status, {
    error: { layer: 'gatehouse', code: error.code, status: error.status, message: error.message, ...extra },
  }, headers);
}

const JSON_TYPE = /^application\/json\s*(;\s*charset=utf-8\s*)?$/i;

/**
 * Read and parse a JSON body. Only `application/json` is accepted: the
 * content types an HTML form can send cross-site (text/plain,
 * application/x-www-form-urlencoded, multipart/form-data) are refused, so a
 * forged form post never reaches the batch core.
 */
export function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!JSON_TYPE.test(req.headers['content-type'] ?? '')) {
      reject(new HttpError(415, 'P-MEDIA', 'Content-Type must be application/json'));
      req.resume();
      return;
    }
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(new HttpError(413, 'P-SIZE', `Request body exceeds ${maxBytes} bytes`));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > maxBytes) {
        failed = true;
        reject(new HttpError(413, 'P-SIZE', `Request body exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => {
      if (!failed) reject(new HttpError(400, 'P-JSON', 'Request body could not be read'));
      failed = true;
    });
    req.on('end', () => {
      if (failed) return;
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      } catch {
        reject(new HttpError(400, 'P-JSON', 'Request body is not valid UTF-8'));
        return;
      }
      try {
        resolve({ value: JSON.parse(text), bytes: size });
      } catch {
        reject(new HttpError(400, 'P-JSON', 'Request body is not valid JSON'));
      }
    });
  });
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * DNS-rebinding guard: the Host header must name this machine (or a host
 * explicitly allowed), so a hostile page that re-points its own domain at
 * 127.0.0.1 cannot talk to Gatehouse.
 */
export function checkHost(req, allowedHosts) {
  const host = (req.headers.host ?? '').toLowerCase();
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
  if (!LOCAL_HOSTS.has(name) && !allowedHosts.includes(name) && !allowedHosts.includes(host)) {
    throw new HttpError(421, 'P-HOST', 'Unexpected Host header');
  }
}

/** State-changing requests must come from this origin. */
export function checkSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    throw new HttpError(403, 'P-ORIGIN', 'Cross-site requests are not allowed');
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new HttpError(403, 'P-ORIGIN', 'Malformed Origin header');
    }
    if (parsed.host.toLowerCase() !== (req.headers.host ?? '').toLowerCase()) {
      throw new HttpError(403, 'P-ORIGIN', 'Cross-origin requests are not allowed');
    }
  }
}
