# Rampart — security libraries for COBOL and Fortran

Rampart is the wall around the batch core: small, tested building blocks that
make the safe way the easy way in legacy languages.

* **COBOL modules** (GnuCOBOL 3.x, fixed format): validation, sanitising and
  masking of the data that crosses a trust boundary.
* **Fortran 2018 kernel**: SHA-256, HMAC-SHA256, constant-time comparison,
  secure wiping, robust statistics and safe JSON — callable from Fortran,
  COBOL and C through one C ABI.

```bash
make lib     # build/lib/librampart_cob.a and build/lib/librampart_f.a
make test    # 92 COBOL checks, 93 Fortran checks
```

## COBOL modules

Every module is a callable subprogram with `LOCAL-STORAGE` (no state survives
between calls) and `PIC X ANY LENGTH` linkage items, so it always knows the
real size of the caller's field. Every return code is a `PIC S9(9) COMP-5`.

| Module | Call | Returns |
|--------|------|---------|
| `ALZTEXT` | `policy text rc position` | Character policies: `I` identifier, `N` upper alphanumeric, `D` digits, `A` letters, `H` hex, `S` SEPA character set, `P` printable ASCII, `F` no spreadsheet-formula prefix. `rc` 0 ok, 1 bad character (at `position`), 2 formula prefix, 3 empty. |
| `ALZSANIT` | `policy text` | Replaces, in place, every character outside the policy with `?` — for writing untrusted text to reports and logs. |
| `ALZIBAN` | `iban rc` | ISO 13616 structure, country length (55 countries) and ISO 7064 MOD 97-10 check digits. `rc` 0 ok, 1 format, 2 country/length, 3 check digits. |
| `ALZLUHN` | `pan rc` | 12–19 digits and the Luhn check digit. |
| `ALZMASK` | `mode input output` | PCI DSS masking: `P` BIN + last 4, `L` last 4, `I` IBAN country + last 4. Length preserved. |
| `ALZAMNT` | `text sign cents rc position` | Strict decimal parser: `[+-]`, 1–13 digits, optional 1–2 decimals. Never `NUMVAL`; overflow is `rc 2`, not truncation; the sign comes back separately. |
| `ALZDATE` | `timestamp rc` | `YYYYMMDDHHMMSS` with `FUNCTION TEST-DATE-YYYYMMDD`; digits are checked before any numeric field is touched. |
| `ALZCCY` | `currency rc` | ISO 4217 allowlist. |

```cobol
       COPY ALZCAPI.
       01  WS-SIGN                     PIC X.
       01  WS-CENTS                    PIC 9(15) COMP-3.
       01  WS-RC                       PIC S9(9) COMP-5.
       ...
           CALL "ALZAMNT" USING TI-AMOUNT WS-SIGN WS-CENTS WS-RC ALZ-POS
           EVALUATE TRUE
               WHEN WS-RC = 2
                   MOVE "E402" TO WS-REASON
      *            14 integer digits: refused, never truncated.
               WHEN WS-SIGN = "-"
                   MOVE "E403" TO WS-REASON
           END-EVALUATE
```

Copybooks: `ALZTXNIN` / `ALZACCPT` / `ALZREJ` / `ALZLEDG` (record layouts),
`ALZCAPI` (work areas for the Fortran kernel), `ALZKEYW` + `ALZKEYP` (key
handling shared by TXNGUARD and LEDGERCK: job id, key on stdin, HKDF-style
sub-keys, wiping).

## Fortran kernel

| Module | Contents |
|--------|----------|
| `rampart_sha256` | SHA-256 (FIPS 180-4), incremental and one-shot. 32-bit words in `int64` with masking: no reliance on signed overflow. |
| `rampart_hmac` | HMAC-SHA256 (RFC 2104); intermediate key material wiped. |
| `rampart_ct` | `ct_equal` (constant time) and `zeroize` (stores through a `VOLATILE` dummy). |
| `rampart_bytes` | Byte ↔ unsigned conversion, hex codec. |
| `rampart_kat` | Known-answer tests (NIST, RFC 4231) run at start-up. |
| `rampart_stats` | Heapsort, median, MAD, robust z, Benford, chi-square survival function (incomplete gamma), Shannon entropy. |
| `rampart_json` | JSON strings and numbers that are valid by construction. |
| `rampart_capi` | The `bind(C)` entry points. |

```fortran
use rampart_hmac, only: hmac_sha256
use rampart_ct,   only: ct_equal, zeroize
...
call hmac_sha256(key, message, mac)
if (.not. ct_equal(mac, expected)) error stop 'forged'
call zeroize(key)
```

## C ABI

[`fortran/include/alz.h`](fortran/include/alz.h) declares the entry points
COBOL uses — usable from C, Python (`ctypes`), Rust or Go too. Every argument
is passed by reference; every function returns an `int32_t` status.

```c
int32_t keylen = 32, msglen = 181;
char mac[64];
if (alz_hmac_sha256_hex(key, &keylen, line, &msglen, mac) != ALZ_OK) abort();
```

A complete example is in [`fortran/examples/hmac.c`](fortran/examples/hmac.c).
`build/bin/alzsum` is `sha256sum` written in Fortran — its output can be
checked with `sha256sum -c`.

## Why the details matter

See [docs/HARDENING.md](../docs/HARDENING.md): the compiler flags, and the
pitfalls measured while writing this code (silent truncation, record
splitting, a C-ABI name clash that compiled into infinite recursion, JSON
numbers without leading zeros...).
