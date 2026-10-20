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

*Defence:* untrusted input (`TXNIN.DAT`) is fixed-length `ORGANIZATION
SEQUENTIAL` with no line terminators, so a newline in the data is just a byte.
Gatehouse also refuses control characters before writing a record.
Watchtower flags LINE SEQUENTIAL input whose status is never checked for
`04`/`06` (rule `ALZ-COB-016`).

### 2. A short final record keeps stale bytes — with status 00

In a fixed-length SEQUENTIAL file whose size is not a multiple of the record
length, the final `READ` returns status `00`, fills only the bytes it read,
and **leaves the rest of the record area holding the previous record**: a
3-byte fragment `KLM` came back as `KLMDEFGHIJ`.

*Defence:* TXNGUARD moves `LOW-VALUES` into the record area before every
`READ`. A fragment then fails the printable-ASCII structure check and is
rejected with `E901` — the sample batch in the tests ends with exactly such a
fragment.

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
LEDGERCK wipe the master key right after deriving the sub-keys, and the
sub-keys at the end of the run.

### 11. The environment can rewire a COBOL program

GnuCOBOL maps file names through environment variables (`DD_name`,
`dd_name`, `name`, `COB_FILE_PATH`) and loads modules from
`COB_LIBRARY_PATH`.

*Defence:* static calls (above), and Gatehouse starts every batch program with
an allow-listed environment (`PATH`, `LC_ALL` — nothing else), no shell, and
the key on stdin.

### 12. Statistics have pitfalls too

Nigrini's MAD thresholds for Benford's law assume thousands of amounts. With
200 amounts, sampling noise alone gives MAD ≈ 0.017 — "nonconforming" for a
perfectly honest batch. Likewise a per-account z-score computed from five
similar transfers makes ordinary ones look extreme.

*Defence:* below 1,000 amounts FRAUDSCAN decides on the chi-square p-value
(and says so in `verdictBasis`); robust z-scores use the median and MAD with a
scale floor, so a transfer has to be ~7.5× off the sender's typical amount.
The parameters were chosen by simulation, not by eye.

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

*Defence:* the Seal ledger is read as fixed-length records whose last byte
must be a line feed (see the ledger format v2 below), and the Node verifier
rejects a missing final newline the same way.

### Not a vulnerability, but you will see it

On Debian 13, every GnuCOBOL program prints *"program compiled against libxml
212 using older 209"*: the distribution ships libxml2 2.9.14 under the
version number 2.12.7 (`2.12.7+dfsg+really2.9.14`), and libxml2's own version
check notices. It is harmless — Alcazar does not use COBOL's XML features —
and Gatehouse keeps stderr out of responses.
