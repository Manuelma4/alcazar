# Changelog

## 0.1.0 — 2026-10-20

First public version.

* **Rampart** — COBOL security modules (character policies, sanitising,
  IBAN ISO 13616 / ISO 7064, Luhn, PCI DSS masking, strict amount parsing,
  calendar dates, currency allowlist, card numbers in free text) and a Fortran 2018 kernel (SHA-256,
  HMAC-SHA256, constant-time comparison, secure wiping, hex, robust
  statistics, safe JSON) with a C ABI (`alz.h`) and power-on self-tests.
* **TXNGUARD / LEDGERCK / FRAUDSCAN** — the demo batch core: validation and
  pseudonymisation in COBOL, an HMAC-chained audit ledger (Seal), Benford,
  robust z-score, structuring, velocity and entropy analytics in Fortran.
* **Gatehouse** — zero-dependency Node.js gateway: strict CSP and security
  headers, schema validation, rate limiting, sandboxed execution of the
  legacy programs, double ledger verification (COBOL/Fortran and OpenSSL)
  plus an external anchor, Node.js permission model.
* **Watchtower** — static analyzer for COBOL and Fortran with text, JSON and
  SARIF output.
* **Lookout** — dashboard with the Siege attack lab, ledger tampering demo
  and in-browser code scanning.
* Docker image with the core compiled and tested at build time, hardened
  compose file, CI with pinned actions.
