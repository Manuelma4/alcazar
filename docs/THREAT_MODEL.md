# Threat model

Alcazar demonstrates how to put a web front end on a legacy COBOL/Fortran
batch core without inheriting the web's attack surface. This document states
what is protected, from whom, where the trust boundaries are, and what is
explicitly **not** covered.

## Assets

| Asset | Why it matters |
|-------|----------------|
| Card numbers (PAN) | PCI DSS data; must never be stored or displayed in full. |
| IBANs and payment metadata | Personal data (GDPR); must be minimised and pseudonymised. |
| Integrity of decisions | A forged "accepted" or a deleted "rejected" is fraud. |
| The audit ledger (Seal) | Evidence; must be tamper-evident. |
| The master ledger key | Whoever holds it can forge ledger entries. |
| Availability of the batch core | Legacy programs are slow to restart and easy to overload. |
| Integrity of the dashboard | Script injection would let an attacker act as the operator. |

## Adversaries

1. **Remote attacker** — sends arbitrary HTTP to Gatehouse, or lures an
   operator's browser to a hostile page (CSRF, DNS rebinding, XSS payloads).
2. **Malicious insider** — has write access to the job directory and edits,
   deletes or truncates ledger files after the fact.
3. **Hostile contributor** — submits code that looks harmless in review
   (Trojan Source, code hidden past column 72, unsafe legacy idioms).
4. **Compromised supply chain** — a malicious npm package or base image.

## Trust boundaries

```mermaid
flowchart LR
  subgraph Browser[Operator browser · untrusted input]
    L[Lookout]
  end
  subgraph Host[Gatehouse process · Node.js permission model]
    G[HTTP + schema + rate limit]
    V[Node/OpenSSL verifier + anchor]
  end
  subgraph Batch[Legacy processes · no shell, allow-listed env, rlimits]
    T[TXNGUARD]
    F[FRAUDSCAN]
    C[LEDGERCK]
  end
  subgraph Disk[Job directory · 0700, tmpfs in Docker]
    D[(TXNIN / ACCEPTED / LEDGER)]
  end
  L -- B1: HTTP JSON --> G
  G -- B2: argv + stdin sub-keys + fixed-width file --> T
  T --> D
  D -- B3: legacy outputs parsed as untrusted --> G
  F --> D
  C --> V
```

* **B1 Browser → Gatehouse.** Everything is untrusted.
* **B2 Gatehouse → legacy programs.** The legacy programs re-validate
  everything (defence in depth) and never trust Gatehouse's checks.
* **B3 Legacy outputs → Gatehouse.** Outputs are parsed strictly and treated
  as untrusted: a bug in the core must not become a bug in the front end.

## STRIDE

| Threat | Boundary | Mitigation | Verified by |
|--------|----------|------------|-------------|
| **S**poofing: cross-site requests from a hostile page | B1 | Only `application/json` bodies (forms cannot send it), `Origin` / `Sec-Fetch-Site` must be same-origin, `Host` must be local or allow-listed (DNS rebinding) | `gatehouse/test/server.test.mjs`, Siege `content-type` |
| **S**poofing: API use without the operator | B1 | Optional bearer token (`ALCAZAR_API_TOKEN`), compared in constant time | `server.test.mjs` |
| **T**ampering: record injection via CR/LF or over-long fields | B1, B2 | Printable ASCII only at Gatehouse; fixed-length records with no terminators in COBOL; LOW-VALUES pre-fill catches fragments | Siege `record-injection`, COBOL tests |
| **T**ampering: sign flip, truncation, fractional cents | B2 | Strict amount grammar, ON SIZE ERROR, separate sign | Siege `sign-flip`, `truncation`, `salami` |
| **T**ampering: forged identifiers (IBAN, card) | B2 | ISO 7064 MOD 97-10 with the never-issued check digits 00/01/99 refused (one account, two IBANs), ISO 13616 country lengths, Luhn | Siege `iban-checksum`, `iban-alias`, `pan-luhn` |
| **T**ampering: injection (SQL, HTML, formulas, shell) | B1, B2 | No shell anywhere (spawn with argv), SEPA character set, formula-prefix rule, DOM built without HTML parsing + Trusted Types | Siege `xss-memo`, `sqli-memo`, `formula-injection`, `cmd-injection` |
| **T**ampering: editing the ledger | Disk | HMAC-SHA256 chain over every entry and the previous MAC, files read as fixed-length records (no reader normalisation); LEDGERCK and an independent OpenSSL implementation must agree | Siege `ledger-tamper`, `ledger-delete`; `agreement.test.mjs` (250 random corruptions, identical verdicts) |
| **T**ampering: editing a decision record (redirecting a payment, rewriting a rejection) | Disk | Each ledger entry seals an HMAC of its whole ACCEPTED or REJECTED record; records with no entry are refused | Siege `record-tamper`, `ledger.test.mjs` |
| **T**ampering: truncating the ledger (and its records) | Disk | Head MAC and entry count anchored in Gatehouse memory when the job is sealed | Siege `ledger-truncate` |
| **T**ampering: Trojan Source / hidden code in contributions | Repo | `scripts/check-unicode.mjs` in CI; Watchtower `ALZ-GEN-001/002`, `ALZ-COB-014` | CI |
| **R**epudiation: "that transfer was never submitted" | B2 | Every record — accepted *or rejected* — is sealed in the ledger, bound to the job id | `ledger.test.mjs` |
| **I**nformation disclosure: card numbers | B2, B3 | Raw input deleted right after TXNGUARD, and job directories left by a crash removed at start-up; only BIN + last 4 (ACCEPTED) or last 4 (ledger) ever leave the core | `server.test.mjs` asserts no raw PAN in responses; `review.test.mjs` |
| **I**nformation disclosure: account identity in analytics | B2 | FRAUDSCAN sees only HMAC tokens (`K_token`), never IBANs | `parseAccepted` tests |
| **I**nformation disclosure: key exposure | B2 | The master key never leaves Gatehouse; each legacy program gets only its sub-keys (LEDGERCK: `K_ledger` only), on stdin (not argv, not env), wiped after use; equal sub-keys refused; key file refused if group/world readable | `review.test.mjs`, `ALZKEYP.cpy`, `app.mjs` |
| **I**nformation disclosure: timing side channel on MAC checks | B3 | Constant-time comparison in Fortran (`alz_ct_equal`) and Node (`timingSafeEqual`) | `test_crypto.f90` |
| **D**enial of service: huge or many requests | B1 | 512 KiB body cap, 1,000 transactions per batch, token-bucket rate limit keyed on the trusted proxy's hop, at most 4 legacy processes at once on every path with a bounded queue, batch slots taken only after the body is read, bounded job store with TTL, header/request timeouts, bounded shutdown | `server.test.mjs`, `review.test.mjs`, Siege `flood` |
| **D**enial of service: a runaway legacy program | B2 | SIGKILL after the timeout, bounded stdout/stderr, prlimit CPU / memory / file size / no core dumps (Linux) | `runner.mjs` |
| **E**levation: path traversal | B1 | Static files served from an in-memory map; no URL becomes a path | Siege `path-traversal` |
| **E**levation: hijacking the legacy runtime | B2 | `-fstatic-call`, allow-listed environment (no `COB_LIBRARY_PATH`, `DD_*`, `LD_PRELOAD`), no shell | `runner.mjs` |
| **E**levation: compromised dependency | Supply chain | Zero npm dependencies (runtime and dev), base images pinned by digest, GitHub Actions pinned by commit SHA, Dependabot | CI, `package.json` |
| **E**levation: compromised Gatehouse code reading the host | Host | Node.js permission model in Docker (read: app dir; write: job dir only), non-root user, read-only root FS, all capabilities dropped, `no-new-privileges` | `Dockerfile`, `compose.yaml` |

## Residual risks and non-goals

* **TLS is not terminated by Gatehouse.** Put it behind a reverse proxy and set
  `ALCAZAR_HSTS=1`; by default Docker publishes on `127.0.0.1` only.
* **The master key lives in Gatehouse's memory** (generated per start, or
  read from a `0600` file) — the legacy programs only ever see sub-keys.
  Production should keep it in an HSM/KMS and only hand Gatehouse the derived
  keys.
* **Truncation detection depends on the anchor**, which lives in Gatehouse's
  memory for the job's lifetime (15 minutes). A durable deployment must store
  the head MAC somewhere the insider cannot write (WORM storage, a separate
  service, a public transparency log).
* **The Fortran SHA-256 / HMAC kernel is verified against NIST and RFC 4231
  vectors and cross-checked with OpenSSL on every start-up**, but it has not
  had an independent cryptographic or side-channel audit beyond the
  constant-time comparison. For production cryptography prefer a vetted
  library (OpenSSL, libsodium) behind the same `alz.h` ABI.
* **Rate limiting is per client IP** and in memory; behind N proxies set
  `ALCAZAR_TRUST_PROXY=N` (the client is the N-th `X-Forwarded-For` entry from
  the right) and limit at the edge too.
* **Demo mode** (`ALCAZAR_DEMO=1`, the default for the showcase) exposes the
  ledger *tamper* endpoint for the Siege lab. It only rewrites the job's own
  files, but production deployments must set `ALCAZAR_DEMO=0`.
* **Watchtower is a heuristic analyzer**, not a sound verifier: it has no
  full data-flow analysis and does not read EBCDIC sources. Absence of
  findings is not proof of absence of bugs.
* **GnuCOBOL and gfortran runtimes** are trusted; keep them patched.
