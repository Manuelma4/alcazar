# Changelog

## 0.1.0 — 2026-10-20

First public version.

* **Rampart** — COBOL security modules (character policies, sanitising,
  IBAN ISO 13616 / ISO 7064 with the never-issued check digits refused, Luhn,
  PCI DSS masking, strict amount parsing, calendar dates, currency allowlist,
  card numbers in free text) and a Fortran 2018 kernel (SHA-256,
  HMAC-SHA256, constant-time comparison, secure wiping, hex, robust
  statistics, safe JSON, secrets read from stdin without stdio buffers)
  with a C ABI (`alz.h`) and power-on self-tests.
* **TXNGUARD / LEDGERCK / FRAUDSCAN** — the demo batch core: validation and
  pseudonymisation in COBOL with per-currency transfer limits, the batch
  read from stdin so raw card numbers never touch the disk; the Seal, an
  HMAC-chained audit ledger (format v2) whose every entry also seals the full
  accepted or rejected record; Benford, robust z-score, structuring, velocity
  and entropy analytics in Fortran, currency by currency.
* **Gatehouse** — zero-dependency Node.js gateway: strict CSP and security
  headers, schema validation, rate limiting, sandboxed execution of the
  legacy programs with least-privilege sub-keys on stdin (the master key
  never reaches them), double ledger verification (COBOL/Fortran and
  OpenSSL, held to identical verdicts by a differential test) plus an
  external anchor, Node.js permission model.
* **Watchtower** — static analyzer for COBOL and Fortran (34 rules) with
  text, JSON and SARIF output, also usable as a GitHub Action.
* **`scripts/verify-ledger.mjs`** — an auditor's check of a sealed job with
  `K_ledger` alone, both verifiers and the anchor.
* **Lookout** — dashboard with the Siege attack lab (29 attacks), ledger and
  record tampering demo and in-browser code scanning.
* Docker image with the core compiled and tested at build time, hardened
  compose file, CI with pinned actions.
