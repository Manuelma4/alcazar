# Gatehouse — the only door into the legacy core

Gatehouse is a zero-dependency Node.js HTTP server that exposes the COBOL and
Fortran batch programs to the web without exposing them to the web's attack
surface. It serves Lookout (the dashboard) and the JSON API described in
[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

```bash
npm start          # under the Node.js permission model (recommended)
npm run start:dev  # plain node, static files re-read on every page request
```

## What it guarantees

| Concern | Behaviour |
|---------|-----------|
| Input | JSON only (`application/json`), ≤ 512 KiB, ≤ 1,000 transfers, known keys only, printable ASCII only, lengths that fit the fixed-width record. Business rules are left to TXNGUARD, which re-validates everything anyway. |
| Cross-site use | `Origin` and `Sec-Fetch-Site` must be same-origin for every state-changing request; the `Host` header must be local or allow-listed (DNS rebinding); forms cannot send `application/json`. |
| Legacy execution | `spawn` with an argv array and `shell: false`; environment reduced to `PATH` and `LC_ALL`; only the sub-keys each program needs, on stdin; SIGKILL after the timeout; stdout/stderr capped; `prlimit` CPU / memory / file-size / no-core limits on Linux. |
| Data exposure | The batch reaches TXNGUARD on stdin, so raw card numbers never touch the disk; job directories left by a crash are removed at start-up; responses only contain what the COBOL layer masked or tokenised. |
| Legacy output | Parsed strictly as untrusted data (`records.mjs`); anything unexpected is a 502, never a partial answer. |
| Ledger | Every entry seals its ACCEPTED or REJECTED record too (format v2). Verified by LEDGERCK (COBOL + Fortran HMAC) and by Node/OpenSSL (`ledger.mjs`) — they must agree, and a differential test holds them to identical verdicts on hundreds of corrupted files — and checked against the anchor taken when the job was sealed. |
| Static files | Loaded once into an in-memory map; a URL is never turned into a file path. |
| Headers | Strict CSP with Trusted Types, COOP/COEP/CORP, `nosniff`, `DENY` framing, `no-referrer`, a restrictive Permissions-Policy, optional HSTS — on every response, errors included. |
| Abuse | Token-bucket rate limit per client, at most 4 legacy processes at once on every path (batch, verify, tamper) with a bounded queue, 2 concurrent batches taken only after the body is read, a bounded job store (40 jobs, 15-minute TTL, jobs in use never evicted), header and request timeouts, bounded shutdown. |
| Start-up | Power-on self-test: the Fortran known-answer tests, then a real two-transfer batch whose ledger and tokens must match OpenSSL. If anything fails, the batch endpoints answer 503. |

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `ALCAZAR_HOST` | `127.0.0.1` | Interface to listen on (`0.0.0.0` in Docker). |
| `ALCAZAR_PORT` | `8080` | Port. |
| `ALCAZAR_BIN_DIR` | `build/bin` | Where the legacy programs are. |
| `ALCAZAR_WORK_DIR` | `var/jobs` | Job directories (`0700`). Use a tmpfs in production. |
| `ALCAZAR_KEY_FILE` | — | The master key: 64 hex digits, mode `0600` or stricter. Without it a fresh key is generated per process. It stays in Gatehouse; the legacy programs only get sub-keys. |
| `ALCAZAR_API_TOKEN` | — | Require `Authorization: Bearer …` on the API (except `/api/health`). |
| `ALCAZAR_DEMO` | `1` | Enables the tamper endpoint (ledger and record edits) used by the Siege lab. **Set to `0` in production.** |
| `ALCAZAR_ALLOWED_HOSTS` | — | Extra host names accepted in the `Host` header. |
| `ALCAZAR_TRUST_PROXY` | `0` | Number of trusted reverse proxies that append to `X-Forwarded-For`; the client is that many entries from the right (entries further left are client-controlled and ignored). |
| `ALCAZAR_HSTS` | `0` | Send `Strict-Transport-Security` (when served over TLS). |
| `ALCAZAR_JOB_TIMEOUT_MS` | `10000` | Wall-clock limit per legacy program run. |
| `ALCAZAR_MAX_PROCESSES` / `ALCAZAR_PROCESS_QUEUE` | `4` / `32` | Legacy processes running at once across every request path, and how many more may wait before callers get `503 P-BUSY`. |
| `ALCAZAR_RATE_CAPACITY` / `ALCAZAR_RATE_REFILL` | `120` / `2` | Token bucket size and refill per second. |
| `ALCAZAR_STATIC_RELOAD` | `0` | Development only: re-read static files on every page request. |

## Modules

| File | Role |
|------|------|
| `src/app.mjs` | Routing, security checks, power-on self-test |
| `src/http.mjs` | Headers, bounded JSON bodies, same-origin and Host checks |
| `src/schema.mjs` | Structural validation of a batch |
| `src/records.mjs` | Fixed-width writers and strict parsers for the legacy formats |
| `src/runner.mjs` | Sandboxed execution of the legacy programs |
| `src/pipeline.mjs` | One job: TXNGUARD → FRAUDSCAN → three-way ledger verification |
| `src/ledger.mjs` | Independent Node/OpenSSL implementation of the Seal checks |
| `src/sample.mjs` | Deterministic sample batches with planted anomalies |
| `src/jobs.mjs`, `src/ratelimit.mjs`, `src/static.mjs`, `src/watchtower.mjs` | Bounded job store, token bucket, in-memory static files, Watchtower report |

Tests: `npm run test:gatehouse` — unit tests, integration tests against the
real binaries, and the 29-attack Siege.
