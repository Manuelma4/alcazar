# Hardening the legacy toolchain

COBOL and Fortran were designed for closed mainframes and supercomputers,
long before anyone fed them hostile input over HTTP. This page lists the
compiler flags Alcazar builds with, and — more interesting — the pitfalls we
**measured** on GnuCOBOL 3.2 and gfortran 14–16 while building it, each with
the defence now in the code.

## Compiler flags

### Fortran (`gfortran`)

| Flag | What it buys |
|------|--------------|
| `-std=f2018` | Only standard Fortran: no vendor extensions with surprising semantics. |
| `-fimplicit-none` | No implicit typing. A typo can no longer create a fresh variable (`ammount = …`). |
| `-Wall -Wextra -Wpedantic -Wconversion -Wimplicit-interface -Wimplicit-procedure -Wcharacter-truncation -Wsurprising -Werror` | Every warning is an error. Numeric conversions must be explicit, every call has an explicit interface, no silent string truncation, no exact comparison of reals. |
| `-fcheck=bounds,do,mem,pointer,recursion` | Run-time checks: an out-of-bounds index aborts instead of corrupting memory. This flag found a real bug (see 5). |
| `-finit-real=snan -finit-integer=-2147483647 -finit-logical=false` | Uninitialised locals are poisoned with recognisable values instead of silently being zero. |
| `-fstack-protector-strong` | Stack canaries. |
| `-fPIC`, `-Wl,-z,relro,-z,now,-z,noexecstack` (Linux) | Position-independent code, read-only GOT after start-up, non-executable stack. |

### COBOL (GnuCOBOL `cobc`)

| Flag | What it buys |
|------|--------------|
| `-debug` | `-fec=EC-ALL` plus stack checking: subscripts, reference modification, numeric data validity and PERFORM nesting are checked at run time. Bad data aborts the program (fail closed) instead of producing garbage money. |
| `-fstatic-call` | `CALL "LITERAL"` is resolved at link time. No module search path (`COB_LIBRARY_PATH`, `COB_PRE_LOAD`) can substitute a different program. |
| `-Wall` | All warnings. The code compiles without a single one. |
| `-A "-fstack-protector-strong -D_FORTIFY_SOURCE=2 -fno-strict-aliasing"` | GnuCOBOL compiles to C: the generated C gets stack canaries and fortified libc calls. |
| `-Q "-Wl,-z,relro,-z,now,-z,noexecstack"` (Linux) | Same link hardening as above. |

The exact flags of a build are recorded in `build/manifest.json` and shown on
the dashboard's *Defenses* view (`GET /api/posture`).

## Pitfalls we measured

Each item below was observed while building Alcazar.

### 1. LINE SEQUENTIAL splits an over-long line into extra records

Reading a 20-character line into a 10-byte LINE SEQUENTIAL record, GnuCOBOL
3.2 returns status `06` for the first 10 bytes — and then **the rest of the
line comes back as a separate record with status `00`**. If any field of an
input line is longer than expected, it can inject a whole forged record.

*Defence:* untrusted input never goes through LINE SEQUENTIAL: TXNGUARD reads
its batch from stdin with `alz_read_line`, exactly one 200-byte record per
line, and refuses the whole batch when a line is longer than a record — the
rest of it never becomes a record. Gatehouse also refuses control characters
before it sends a record.
Watchtower flags LINE SEQUENTIAL input whose status is never checked for
`04`/`06` (rule `ALZ-COB-016`).

### 2. A short final record keeps stale bytes — with status 00

In a fixed-length SEQUENTIAL file whose size is not a multiple of the record
length, the final `READ` returns status `00`, fills only the bytes it read,
and **leaves the rest of the record area holding the previous record**: a
3-byte fragment `KLM` came back as `KLMDEFGHIJ`.

*Defence:* LEDGERCK moves `LOW-VALUES` into the record area before every
`READ` of a sealed file, so a fragment fails its format check. TXNGUARD no
longer reads a file at all: its batch arrives on stdin, and any line that is
not exactly one 200-byte record — a fragment, an empty line, a stray key —
refuses the whole batch instead of becoming a sealed record.

### 3. MOVE truncates — silently

`MOVE 12345 TO WS-SMALL` (`PIC 9(3)`) stores `345`; moving `-500.00` into an
unsigned `PIC 9(13)V99` stores `500.00`. No status, no warning at run time.
This is the classic sign-flip fraud vector.

*Defence:* `ALZAMNT` parses amounts character by character with an explicit
grammar, accumulates with `COMPUTE … ON SIZE ERROR`, and returns the sign in
a separate field; TXNGUARD then rejects zero, negative (`E403`) and
over-long (`E402`) amounts. Watchtower flags sign-losing and truncating MOVEs
(`ALZ-COB-006`, `ALZ-COB-007`).

### 4. A CALL to a void C function leaves garbage in RETURN-CODE

A COBOL program that called a void Fortran routine (via the C ABI) exited
with status **206** — whatever happened to be in the return register.

*Defence:* every entry point of the Rampart kernel is a function returning an
`int32_t` status, always used with `CALL … RETURNING`.

### 5. A module name and a C binding label share one namespace — "the recursion that wasn't"

The kernel first had a module named `alz_sha256` and a C entry point
`bind(C, name='alz_sha256')`. Both are *global identifiers* in Fortran and
must differ, but gfortran did not diagnose the clash: it compiled the call to
the module procedure `sha256` into a call to the C entry point **itself** — an
infinite recursion that only `-fcheck=recursion` caught, at run time.

*Defence:* Fortran modules are named `rampart_*`, C symbols `alz_*`, and the
Makefile carries a comment so nobody "tidies" them back.

### 6. Short-circuit evaluation is not promised — in either language

gfortran warned that impure functions in `ok = check1() .and. check2()`
*"might not be evaluated"*: the standard lets the compiler skip `check2()`. In
a self-test that silently skips a check. The opposite trap is just as real:
`if (i <= n .and. a(i) > 0)` may evaluate `a(i)` with `i > n`. COBOL makes no
promise either.

*Defence:* every self-test check is evaluated into its own variable; bounds
checks guard array accesses with nested `IF`s (Fortran heapsort, LEDGERCK).
Watchtower rule `ALZ-FOR-014` looks for the unguarded form.

### 7. `F0.d` writes `0.5` as `.500000`

gfortran's minimal-width edit descriptor omits the leading zero, which is
invalid JSON — a parser on the other side either rejects the document or, in
lenient parsers, may misread it.

*Defence:* `rampart_json` formats every number itself (leading zero
restored, scientific notation for tiny values, `null` for NaN/∞) and escapes
every string (`\u00XX` for control and non-ASCII bytes).

### 8. Fortran string equality ignores trailing blanks

`'admin' == 'admin   '` is `.true.`, and `==` stops at the first difference,
leaking timing.

*Defence:* MACs and keys are compared with `ct_equal`, a byte-wise
constant-time comparison (also exposed as `alz_ct_equal` and used by
LEDGERCK). Watchtower rule `ALZ-FOR-008`.

### 9. Signed integer overflow is undefined in Fortran

SHA-256 needs wrapping 32-bit arithmetic, which Fortran does not have.

*Defence:* words are held in `int64` variables in `[0, 2³²)` and masked after
every addition; bytes are widened to `[0, 255]` before any bit operation, so
nothing depends on how negative numbers are represented.

### 10. Dead-store elimination can keep secrets in memory

A loop that wipes a key just before it goes out of scope is a dead store an
optimiser may delete.

*Defence:* `zeroize` writes through a `VOLATILE` dummy argument; TXNGUARD and
LEDGERCK wipe the hex text of each key as soon as it is decoded — read
without stdio, so that buffer is the only copy (item 20) — and the sub-keys
at the end of the run. Gatehouse keeps its copies in `Buffer`s — hex
encoded byte by byte, never through a JavaScript string, which could not be
wiped — and overwrites them on shutdown. A legacy program never holds the
master key at all: Gatehouse derives the sub-keys and sends each program only
the ones it needs.

### 11. The environment can rewire a COBOL program

GnuCOBOL maps file names through environment variables (`DD_name`,
`dd_name`, `name`, `COB_FILE_PATH`) and loads modules from
`COB_LIBRARY_PATH`.

*Defence:* static calls (above), and Gatehouse starts every batch program with
an allow-listed environment (`PATH`, `LC_ALL`, and under the permission model
the `NODE_OPTIONS` Node adds — item 15), no shell, and
the sub-keys on stdin.

### 12. Statistics have pitfalls too

Nigrini's MAD thresholds for Benford's law assume thousands of amounts. With
200 amounts, sampling noise alone gives MAD ≈ 0.017 — "nonconforming" for a
perfectly honest batch. Likewise a per-account z-score computed from five
similar transfers makes ordinary ones look extreme. Mixing currencies is
worse: 5,000 SEK next to a sender's 50 EUR transfers is a 100× "outlier",
and a fixed 9,000–10,000 band calls 9,500 SEK (about 830 EUR) structuring
while 95,000 SEK goes unseen. And the demo's own planted anomaly, a memo of
28 random base32 characters, measured 3.9 bits per character for one seed —
under the 4.0-bit threshold it was meant to cross.

*Defence:* below 1,000 amounts FRAUDSCAN decides on the chi-square p-value
(and says so in `verdictBasis`); robust z-scores use the median and MAD with a
scale floor, so a transfer has to be ~7.5× off the sender's typical amount,
and are computed currency by currency; structuring uses each currency's own
threshold. The parameters were chosen by simulation, not by eye, and the
sample generator plants anomalies that trigger by construction (28 distinct
characters: 4.8 bits), checked for 40 seeds and three batch sizes.

### 13. Tools can turn escapes into the real thing

While writing the Siege scenarios, an editing tool silently turned the escape
`\u202E` into a real right-to-left override character in `shared/lab.mjs` —
Trojan Source (CVE-2021-42574) in our own repository.

*Defence:* `scripts/check-unicode.mjs` fails CI on bidirectional and
invisible characters in any text file (only the intentional sample under
`examples/vulnerable/` is exempt), and Watchtower rule `ALZ-GEN-001` does the
same for COBOL and Fortran sources.

### 14. The Node.js permission model compares paths exactly

`npm start` runs Gatehouse with `--permission`: read access to the
repository, write access to the job directory only. On macOS, a directory
name with accents (this repository lived under `Securité/`) reached Node in
NFD form — `e` + combining accent — while the shell's `$PWD` held the NFC
form, so `--allow-fs-read="$PWD"` silently matched nothing and every relative
import was denied.

*Defence:* `scripts/start-hardened.mjs` computes the allowed paths with
`realpathSync()`, the way Node itself spells them.

### 15. Under `--permission`, `spawn()` writes into the `env` you pass

Node adds `NODE_OPTIONS` to the environment object given to
`child_process.spawn()` so that child Node processes inherit the permission
flags. Gatehouse's allow-listed environment was a frozen object, and every
spawn threw *"Cannot add property NODE_OPTIONS, object is not extensible"* —
the batch core was unreachable, and only the power-on self-test noticed.

*Defence:* the runner passes a fresh copy of the allow-listed environment on
every call. (The extra `NODE_OPTIONS` is harmless to the COBOL and Fortran
programs.)

### 16. A permission grant for a path that does not exist yet covers nothing below it

In the container the job directory lives on a fresh tmpfs, so
`/tmp/alcazar` did not exist when Node started with
`--allow-fs-write=/tmp/alcazar`. Creating the directory was allowed — and
then every write *inside* it was denied, because the grant had been resolved
as a single path rather than a directory tree. Gatehouse's power-on
self-test caught it and the container reported itself `degraded`, refusing
batches instead of half-working.

*Defence:* `scripts/start-hardened.mjs` creates the job directory before it
starts the restricted Node process, and the Docker image uses the same
launcher as `npm start`.

### 17. Some write errors only exist at CLOSE

With a file-size limit (or a full tmpfs), every `WRITE` to the ledger
returned status `00` — the records were only buffered — and the failure
surfaced when `CLOSE` flushed the last buffer. TXNGUARD did not check
`CLOSE`, so a ledger cut at 8 KiB came with `RC=0` and a summary claiming
every entry. (Gatehouse still failed closed: its own verification saw the
short chain.)

*Defence:* TXNGUARD closes and checks every data file *before* writing the
summary, checks every summary write and the summary's own `CLOSE`, and turns
any failure into return code 16.

### 18. A full final line can conjure a phantom record

Reading the 21-byte LINE SEQUENTIAL file `ABCDEFGHIJ\nKLMNOPQRST` (no final
newline) into a 10-byte record, GnuCOBOL 3.2 returned `ABCDEFGHIJ` (00),
then `KLMNOPQRST` (06), then a phantom `T` (00), then end of file. Combined
with CR stripping, a LINE SEQUENTIAL reader verifies a *normalised* view of
the file, not its bytes.

*Defence:* TXNGUARD writes the ledger and the records it seals (`ACCEPTED`,
`REJECTED`) as fixed-length records that end in a line feed — nothing
trimmed — and LEDGERCK reads them back as fixed-length records whose last
byte must be that line feed (ledger format v2, [ARCHITECTURE.md](ARCHITECTURE.md#2-record-layouts-fixed-width-ascii)).
The Node verifier cuts the files the same way, and
`gatehouse/test/agreement.test.mjs` damages them at random (bytes flipped,
inserted and deleted, CRs, NULs, records duplicated, dropped and swapped):
the two verifiers must return the same verdict every time.

### 19. LINE SEQUENTIAL writes a different record than the one you sealed

Writing the 20-byte record `MEMO WITH BLANKS␣␣␣␣` to a LINE SEQUENTIAL file,
GnuCOBOL 3.2 put 17 bytes on disk: the 16 characters and a line feed, status
`00`. Every record whose last field can end in blanks (a memo, a card
number left empty) is shortened on WRITE, so a MAC computed over the record
in memory is not a MAC of the file — and a verifier has to guess the padding
back.

*Defence:* the files the Seal covers (`ACCEPTED`, `REJECTED`, `LEDGER`) are
ORGANIZATION SEQUENTIAL with the line feed as the record's last byte: the
bytes written are exactly the bytes MACed and the bytes read back (item 18).

### 20. ACCEPT keeps a copy of every line it reads

TXNGUARD read its keys with `ACCEPT` and wiped the field right after decoding
them. A scan of the process's writable memory after the wipe still found the
hex text of both keys three times on the heap: in the C library's stdin
buffer and in the COBOL run time's line buffer, which no program can reach to
wipe.

*Defence:* the keys are read with `alz_read_line` (Rampart's C ABI): `read(2)`
into a buffer of the Fortran kernel that is wiped line by line as each line
is handed over, so the COBOL field is the only copy left; the same scan then
finds none. The batch comes the same way, and TXNGUARD wipes each record and
its work field once judged, and the unread rest of a refused batch
(`alz_discard_input`); ALZPANSC wipes its work areas before returning. A scan
at `STOP RUN` found two copies of a card number before, seven after a refused
batch — and none now. `alz_expect_eof` then makes a program
refuse to run when stdin holds more than its own keys — LEDGERCK handed
K-token too is refused. Gatehouse decodes the master key file byte by byte
as well; the hex never becomes a JavaScript string.

### 21. A Luhn check is not a card check

One digit string in ten passes Luhn by chance, and some identifiers pass it
by design: a French SIRET ("552 081 317 00018") and an IMEI
("352099001761481") are Luhn-valid. A memo scanner that stopped at "13–19
digits and Luhn" refused 10–16 % of ordinary reference numbers and every
SIRET it saw; one that skipped tokens glued to capital letters, to spare
IBANs, missed "VISA4111111111111111" and still flagged lower-case IBANs.

*Defence:* ALZPANSC sets aside only IBANs that ALZIBAN confirms (either
case). It takes any Luhn-valid 16- or 19-digit number starting with 2–6 —
the lengths card networks issue, whatever their prefix (Dankort, Bancontact,
BORICA...) — and, for 13, 14, 15, 17 and 18 digits, wants a network that
issues that length with that prefix (Visa 4: 13, Amex 34/37: 15, Diners: 14).
Measured on random look-alikes: IBANs, invoices with dates and phone numbers
0 %, references 4–8 %, SIRET 1.7 %; every card format tried is found. COBOL
and the reference model agree on 100,000 fuzzed memos.

### 22. A sandbox also fences off the one secret it needs

`npm start` and the Docker image ran Gatehouse with read access to the
repository and the job directory only, so a master key kept anywhere else —
a secret mount such as `/run/secrets`, an operator's `0600` file — was
denied, and Gatehouse stopped with `ERR_ACCESS_DENIED` before it listened.
That left two choices: no key file (a fresh key per start, so an auditor can
never be handed K_ledger for yesterday's ledgers) or a key in the job
directory, the insider's territory.

*Defence:* the launcher resolves `ALCAZAR_KEY_FILE`, grants read access to
that one file and nothing beside it, and hands Gatehouse the resolved path.
Gatehouse refuses a key file inside the job directory. `compose.yaml` shows
the key as a read-only Docker secret.

### 23. A token the dashboard cannot send is an optional token

Gatehouse accepted a bearer token, `ALCAZAR_API_TOKEN`, and Lookout, its
only client, had no way to send one. Setting it broke the dashboard, so in
practice the API was open to anything that could reach the port: any local
process, or the network behind a `docker run -p`. The `Origin` and
`Sec-Fetch-Site` checks stop browsers, not scripts.

*Defence:* every API call but `/api/health` needs the operator. Lookout
trades the token for an HttpOnly, SameSite=Strict session cookie, so no
script in the page ever holds it. A run without a configured token
generates one and prints it once, as a sign-in link carried in the URL
fragment, which browsers never send to a server. `ALCAZAR_AUTH=none` is
refused off loopback, and demo mode is off unless asked for.

### 24. A key that verifies can also seal

`K_ledger` both computes and checks every MAC of the chain. Handing it to an
auditor, as the audit tool invited, also handed over the power to seal a
complete, valid ledger for any job id, including one whose head matches what
the auditor computes.

*Defence:* Gatehouse signs each anchor — job id, entry count, head, sealing
time — with an Ed25519 key derived from the master key. Auditors get the
public key (`scripts/audit-keys.mjs`), which verifies and cannot sign. The
audit tool checks the signature with a key the auditor brings, never with
one a document names.

### 25. "Intact" needs something to be intact against

`scripts/verify-ledger.mjs` answered INTACT, exit 0, when no anchor was
given — even for an empty directory, since no entries make a valid chain. An
audit pipeline that checks exit codes would have passed a deleted job, or
another job's complete files under its name.

*Defence:* without an anchor the verdict is UNANCHORED (exit 3), an empty
ledger is BROKEN, and a signed anchor names its job.

### 26. A report can be well-formed and still lie

Gatehouse checked FRAUDSCAN's JSON against its schema only. A report that
scored ids nobody sent, left a transfer out, or said `flagged: 0` next to a
flagged transfer passed, and the dashboard showed it as the verdict.

*Defence:* the report must have scored exactly the accepted records, in
order, with counts that add up and their amount range.

### 27. Evidence that expires is not evidence

The Seal was described as evidence, yet the only copy lived in the job
store: a 15-minute cache of 40 jobs, emptied by a restart, whose oldest job
any client could evict by sending 40 small batches.

*Defence:* with `ALCAZAR_EVIDENCE_DIR`, each sealed job's verified bytes and
signed anchor are written once, read-only, outside the job directory, and
outlive the job and the process. Only operators can submit batches now.
Write-once storage under that directory (WORM, object lock) is the
deployment's part. Evidence also needs a master key that outlives the
process (`ALCAZAR_KEY_FILE`): sealed with a key generated per run, it would
outlive every key that could check it, and Gatehouse refuses to start.

### 28. A new Node puts the network under the permission model

Dependabot's first pull request moved the image from Node 24 to Node 26, and
the container stopped at start-up: `ERR_ACCESS_DENIED ... Use --allow-net`.
From Node 25 the permission model covers the network as well, so a server
started with `--permission` and the old grants cannot even listen. The image
built, the unit tests (on Node 24) passed, and only the container job's
health check noticed.

*Defence:* the launcher adds `--allow-net` when the Node that runs it knows
the flag (`process.allowedNodeEnvironmentFlags`) — Node 24 would refuse an
unknown flag — and CI runs the Siege against the image on every push and
pull request.

### Not a vulnerability, but you will see it

On Debian 13, every GnuCOBOL program prints *"program compiled against libxml
212 using older 209"*: the distribution ships libxml2 2.9.14 under the
version number 2.12.7 (`2.12.7+dfsg+really2.9.14`), and libxml2's own version
check notices. It is harmless — Alcazar does not use COBOL's XML features —
and Gatehouse keeps stderr out of responses.
