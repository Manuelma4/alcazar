# Security policy

Alcazar is a security project, so reports are very welcome.

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x (`main`) | Yes |

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private vulnerability
reporting: *Security* tab → *Report a vulnerability*. Include:

* the component (Rampart COBOL/Fortran, TXNGUARD, LEDGERCK, FRAUDSCAN,
  Gatehouse, Lookout, Watchtower) and the commit you tested;
* steps to reproduce, ideally as a Siege-style scenario (`shared/lab.mjs`) or
  a failing test;
* the impact you expect.

What to expect:

* acknowledgement within **3 working days**;
* an assessment and a fix plan within **10 working days**;
* credit in the release notes, unless you prefer to stay anonymous.

## Scope

In scope: anything that breaks a property promised in
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) — for example a transfer that
reaches the ledger as accepted although a rule should reject it, a ledger
change that verification does not detect, a raw card number leaving the
core, script execution in the dashboard, a way to run commands or read files
through Gatehouse, or a Watchtower crash or hang on crafted source code.

Out of scope: the residual risks listed in the threat model (for example the
demo-only tamper endpoint, the legacy programs running unconfined as
Gatehouse's user, or missing TLS when Gatehouse is exposed without a proxy),
denial of service by sheer traffic volume, and findings that need a
compromised host.

## Deploying it

Run `node scripts/start-hardened.mjs` (demo mode off) — or the image — with
`ALCAZAR_KEY_FILE` and `ALCAZAR_API_TOKEN_FILE` on a read-only secret mount
and `ALCAZAR_EVIDENCE_DIR` on write-once storage, behind a TLS proxy with
`ALCAZAR_HSTS=1`. The threat model's residual risks say what that still
leaves to the deployment.

## Safe harbour

Good-faith research that respects this policy, avoids privacy violations and
service degradation, and gives us reasonable time to fix before disclosure
will not be pursued.

## A note on the cryptography

The SHA-256 and HMAC-SHA256 kernel is written in Fortran to show that it can
be done safely. It is checked against the NIST FIPS 180-4 examples and the
RFC 4231 test cases, and against OpenSSL on every Gatehouse start-up, but it
has not been independently audited. Production systems should plug a vetted
library behind the same C ABI (`rampart/fortran/include/alz.h`).
