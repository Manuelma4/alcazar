# Walkthrough: hardening a legacy COBOL program

A nightly funds-transfer batch, the way many still look — and how to make it
safe with Alcazar in four steps: **find** the flaws with Watchtower,
**understand** the dangerous ones, **fix** them with the Rampart patterns, and
**keep** them fixed in CI.

The program is [`examples/vulnerable/ACCTXFER.cbl`](../examples/vulnerable/ACCTXFER.cbl):
125 lines of fixed-format COBOL that reads transfers from a file, posts them,
writes a log, calls a fraud check and notifies operations. Its fixed version
is [`examples/hardened/ACCTXFER.cbl`](../examples/hardened/ACCTXFER.cbl).

## 1. Find — Watchtower

```console
$ node watchtower/bin/watchtower.mjs scan examples/vulnerable/ACCTXFER.cbl
▸ examples/vulnerable/ACCTXFER.cbl  cobol · fixed · 15 findings
  ...
Summary  1 file · 15 findings
  critical     1  █████
  high         3  ████████████████
  medium       6  ████████████████████████████████
  low          5  ███████████████████████████
✖ FAIL  4 unsuppressed findings at or above "high"
```

Read as *what an attacker gets*, the fifteen findings are:

| An attacker can… | Because of | Line |
|------------------|------------|-----:|
| run shell commands through a beneficiary name | `CALL "SYSTEM"` with record data — [ALZ-COB-002](rules/ALZ-COB-002.md) | 104 |
| choose which program runs as the "fraud check" | `CALL WS-FRAUD-PGM` with the routing code — [ALZ-COB-001](rules/ALZ-COB-001.md) | 95 |
| turn a debit into a credit | signed → unsigned `MOVE` — [ALZ-COB-006](rules/ALZ-COB-006.md) | 79 |
| make amounts wrap or divide by zero | truncating `MOVE`, arithmetic without `ON SIZE ERROR` — [ALZ-COB-007](rules/ALZ-COB-007.md), [009](rules/ALZ-COB-009.md), [010](rules/ALZ-COB-010.md) | 80–84 |
| keep the fractions of a cent | money arithmetic without `ROUNDED` — [ALZ-COB-013](rules/ALZ-COB-013.md) | 83–84 |
| slip a watch-listed transfer through | a condition past column 72 — [ALZ-COB-014](rules/ALZ-COB-014.md) | 85 |
| inject a whole extra record | unchecked LINE SEQUENTIAL splitting — [ALZ-COB-016](rules/ALZ-COB-016.md) | 21 |
| read card numbers in SYSOUT | `DISPLAY` of the PAN — [ALZ-COB-005](rules/ALZ-COB-005.md) | 91 |
| lift the database password from the load module | `VALUE "Tr3asury#2019"` — [ALZ-COB-004](rules/ALZ-COB-004.md) | 44 |
| make I/O errors invisible | a file without `FILE STATUS` — [ALZ-COB-012](rules/ALZ-COB-012.md) | 24 |
| hide control flow from reviewers | `ALTER` — [ALZ-COB-015](rules/ALZ-COB-015.md) | 97 |
| truncate beneficiary names | `PIC X(40)` into `PIC X(20)` — [ALZ-COB-008](rules/ALZ-COB-008.md) | 81 |

One more thing in the file: a `watchtower-ignore` comment with no reason
(line 90). Watchtower ignores it on purpose — an unjustified suppression
never hides a finding.

## 2. Understand — three traps the compiler stays silent about

All three were checked with GnuCOBOL 3.2 and `cobc -Wall`, which reports
only that `AUTHOR` and `ALTER` are obsolete.

### The check that isn't there

```cobol
008500     IF WS-XFER-AMT > WS-DAILY-LIMIT                              OR WS-WATCHLIST-HIT = "Y"
```

In fixed format the compiler reads columns 8–72 and **ignores 73–80** (once
the sequence-number area). The `OR WS-WATCHLIST-HIT = "Y"` a reviewer sees
starts at column 73: it is not compiled. A minimal program with the same line
and a watch-listed transfer prints:

```text
watch-listed transfer accepted
```

### The debit that becomes a credit

```cobol
004800 01  WS-XFER-AMT                 PIC S9(9)V99.
004900 01  WS-POSTED-AMT               PIC 9(9)V99.
007900     MOVE WS-XFER-AMT TO WS-POSTED-AMT
```

`WS-POSTED-AMT` has no `S`: a `MOVE` of `-500.00` stores **`500.00`** — no
status, no warning, no abend. The same goes for digits: a `MOVE` into a
narrower field silently drops the high-order ones (`12345` into `PIC 9(3)` is
`345`).

### One line, two records

GnuCOBOL returns an over-long LINE SEQUENTIAL line as **two** records: the
first part with status `06`, then the rest of the line with status `00`. The
program only expects `00` and `10`, so a single crafted line injects a
second, fully attacker-controlled transfer. ([HARDENING.md](HARDENING.md),
items 1 and 3, shows how these two were measured.)

## 3. Fix — the Rampart patterns

The hardened program applies one pattern per finding. In Alcazar's own batch
core (TXNGUARD) the same ideas are packaged as reusable
[Rampart modules](../rampart/README.md).

**Untrusted input — check every status, and never reuse stale bytes:**

```cobol
           88  XFER-LENGTH-ERROR       VALUE "04" "06".
      ...
           MOVE LOW-VALUES TO XFER-IN-REC
           READ XFER-IN
           ...
               WHEN XFER-LENGTH-ERROR
                   IF WS-XFER-FS = "06"
                       SET SKIP-TAIL TO TRUE
                   END-IF
                   PERFORM 8100-REJECT-RECORD
```

TXNGUARD goes further: it reads no input file. The batch arrives on stdin,
one 200-byte record per line, and a line of any other length — or input that
ends inside a line — refuses the whole batch (return code 8), so no record
can be injected.

**Money — signed receivers, explicit rules, no silent rounding:**

```cobol
       01  WS-POSTED-AMT               PIC S9(9)V99.
      ...
           IF WS-XFER-AMT NOT > 0
               PERFORM 8000-REJECT-TRANSFER
           END-IF
           COMPUTE WS-FEE-AMT ROUNDED = WS-XFER-AMT * 0.0025
               ON SIZE ERROR
                   PERFORM 8000-REJECT-TRANSFER
           END-COMPUTE
```

TXNGUARD uses `ALZAMNT`, a strict character-by-character amount parser that
returns the sign separately and refuses a 14th integer digit instead of
truncating it.

**Calls — an allowlist of literals, and the verdict decides:**

```cobol
           EVALUATE IN-ROUTE-CODE
               WHEN "STANDARD"
                   CALL "FRAUDCHK" USING XFER-IN-REC WS-FRAUD-RC
               WHEN "PRIORITY"
                   CALL "FRAUDPRI" USING XFER-IN-REC WS-FRAUD-RC
               WHEN OTHER
                   MOVE 1 TO WS-FRAUD-RC
           END-EVALUATE
           IF WS-FRAUD-RC NOT = 0
               PERFORM 8000-REJECT-TRANSFER
```

Compile with `-fstatic-call`, and no `COB_LIBRARY_PATH` can substitute
another `FRAUDCHK` at run time.

**No shell** — operations are notified through a queue file instead of
`CALL "SYSTEM"`. **No secrets in source** — the password comes from the
environment and is wiped after use. **No PAN in logs** — only BIN + last 4.
**No ALTER** — plain `EVALUATE` and `PERFORM`.

```console
$ node watchtower/bin/watchtower.mjs scan examples/hardened/ACCTXFER.cbl --fail-on info
✔ PASS  no unsuppressed findings at or above "info".
```

### What static analysis did not catch

Our first hardened version passed Watchtower and still had a bug: a transfer
rejected for its limit or its route was *still* routed and announced as done,
and the fraud check's return code was ignored. A human review caught it.
Watchtower finds dangerous *constructs*; it cannot know that "rejected" must
mean "stop". Static analysis is necessary, not sufficient — which is why
Alcazar also tests its batch core against an independent model of the
business rules (`gatehouse/test/model.test.mjs`).

## 4. Keep it fixed — CI

```yaml
- uses: Manuelma4/alcazar/watchtower@main   # pin a release commit SHA in production
  with:
    paths: src/cobol src/fortran
    fail-on: high
- uses: github/codeql-action/upload-sarif@6f2ac81f5cd81fe351a197ba0b00d91d03cd2aee # v4.39.0
  if: always()
  with:
    sarif_file: watchtower.sarif
```

Findings then appear in the repository's *Security → Code scanning* tab, and
a pull request that adds a sign-losing `MOVE` fails. When a finding is a
deliberate, reviewed exception, say why in the code:

```cobol
      *> watchtower-ignore ALZ-COB-006 -- amount validated positive above
```

## 5. And if it needs a web front end

Do not let the web talk to the batch program directly. Put a gate in front
of it that never uses a shell, passes secrets on stdin, writes fixed-length
records it validated, parses the outputs as untrusted data, and verifies the
audit trail independently. That is what [Gatehouse](../gatehouse/README.md)
does — and the [Siege](../README.md#the-siege) proves it against 29 attacks.
