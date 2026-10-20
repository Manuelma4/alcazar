# Contributing to Alcazar

Thank you for helping legacy code stay safe.

## Set up

| Tool | Version | macOS | Debian / Ubuntu |
|------|---------|-------|-----------------|
| GnuCOBOL | ≥ 3.1 (3.2 tested) | `brew install gnucobol` | `apt install gnucobol3` |
| gfortran | ≥ 12 (14 and 16 tested) | `brew install gcc` | `apt install gfortran` |
| Node.js | ≥ 22.13 (24 tested) | `brew install node` | nodesource / nvm |

There is nothing to `npm install`: Alcazar has **zero** runtime and
development dependencies, and new ones are not accepted.

```bash
make            # build the COBOL / Fortran core (warnings are errors)
make test       # Fortran and COBOL test suites
npm test        # Gatehouse, Siege, Watchtower and Lookout tests
make check      # everything above + the Watchtower self-scan
npm run start:dev   # Gatehouse on http://localhost:8080 with live static reload
```

## Rules of the house

* **Every defence comes with an attack.** A new validation, check or header
  needs a Siege scenario in `shared/lab.mjs` (it then runs in
  `gatehouse/test/siege.test.mjs` and appears in the dashboard) or a failing
  test that it fixes.
* **Never trust the front.** The COBOL and Fortran programs re-validate
  everything Gatehouse already checked, and Gatehouse parses legacy output as
  untrusted data.
* **Watchtower stays clean.** `node watchtower/bin/watchtower.mjs scan rampart
  apps --fail-on low` must report nothing. A suppression needs a written
  justification (`*> watchtower-ignore ALZ-COB-006 -- why it is safe`).
* **No bidirectional or invisible characters** anywhere
  (`npm run check:unicode`); write `\u{202E}` escapes in JavaScript instead.

### COBOL

* Fixed format: code in columns 8–72, nothing beyond column 72.
* Subprograms use `LOCAL-STORAGE` (no state survives between calls) and
  `PIC X ANY LENGTH` linkage items, so the callee knows the caller's size.
* Every `SELECT` has a `FILE STATUS`; every status is checked.
* No `MOVE` that can lose a sign or digits; arithmetic on money uses
  `ON SIZE ERROR`. No `FUNCTION NUMVAL` on untrusted input.
* `CALL "LITERAL"` only (compiled with `-fstatic-call`); calls into the
  Fortran kernel always use `RETURNING`.
* Character classes list their members explicitly (EBCDIC-safe).
* Secrets are never read with `ACCEPT` (stdio and the run time keep copies
  no one can wipe): use `alz_read_line` into a field you zeroize, and
  `alz_expect_eof` to refuse input beyond what the program needs.
* A file that is sealed or hashed is ORGANIZATION SEQUENTIAL with an
  explicit line feed, never LINE SEQUENTIAL (it trims trailing blanks on
  WRITE and normalises what it reads).

### Fortran

* `implicit none` everywhere; explicit kinds from `iso_fortran_env`.
* `iostat=` on every I/O statement; fail closed on bad input.
* Assumed-size arrays only in `bind(C)` entry points, behind a validated
  length argument.
* Module names (`rampart_*`) must never equal a C binding label (`alz_*`).
* Evaluate checks into variables before combining them with `.and.`.
* Never compare amounts across currencies.

### JavaScript

* ES modules, JSDoc types, no build step.
* In the browser: no `innerHTML` & co., no inline scripts or styles — the
  page runs under a strict CSP with Trusted Types enforced.

## Pull requests

Keep them focused, describe the threat you address, and include the test
output. Security issues go through [SECURITY.md](SECURITY.md), not public
issues.
