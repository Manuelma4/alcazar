# Examples

Demo material for [Watchtower](../watchtower/README.md), the Alcazar static analyzer.

| Directory | Contents |
|---|---|
| [`vulnerable/`](vulnerable/) | **Intentionally vulnerable** legacy-style programs. Every flaw is deliberate and documented in the file header. Do not reuse this code. Together they trigger every Watchtower rule at least once. |
| [`hardened/`](hardened/) | The same programs written the secure way. Watchtower reports **zero findings** on them (one justified in-source suppression shows how BIND(C) assumed-size arrays are documented). |
| [`batch/`](batch/) | A sample TXNGUARD input batch for `make demo` (see its README); it contains data, not source code. |

| Program | Vulnerable | Hardened | Highlights |
|---|---|---|---|
| `PAYROLL.cob` + `EMPREC.cpy` | yes | yes | Monthly payroll: division and money arithmetic without `ON SIZE ERROR`, no `ROUNDED`, `COMP-2` tax, truncating MOVEs (one through a copybook field), IBAN on SYSOUT, `CALL "SYSTEM"` with a literal. |
| `ACCTXFER.cbl` | yes | yes | Funds transfer: sign-loss MOVE, numeric and text truncation, dynamic `CALL` chosen by the input record, `CALL "SYSTEM"` with record data, hard-coded password, PAN on SYSOUT, file without FILE STATUS, unchecked LINE SEQUENTIAL record splitting, `ALTER`, a condition hidden in columns 73-80, and an unjustified suppression that is ignored. |
| `CUSTSQL.cbl` | yes | - | Embedded SQL: `PREPARE ... FROM :host` and `EXECUTE IMMEDIATE :host` built with `STRING`. |
| `loancalc.f` | yes | yes | Fortran 77 fixed form: no `IMPLICIT NONE`, `COMMON`, `EQUIVALENCE`, `REAL*4` money, exact float comparison, arithmetic IF, computed GO TO, I/O without `IOSTAT`, assumed-size dummy, bound check without short-circuit. |
| `risk_engine.f90` | yes | yes | Modern Fortran: `execute_command_line` with a built command, `random_number` session tokens, secrets compared with `==`, hard-coded API key (AWS's public documentation example key), runtime format string, I/O without `iostat`, unprotected substring index, single-precision money. |
| `trojan_source.cob` | yes | - | Real Unicode bidirectional controls (CVE-2021-42574), a zero-width space and a Cyrillic homoglyph identifier. It is the only file of the repository allowed to contain such characters (see `scripts/check-unicode.mjs`). |

## Try it

```sh
node watchtower/bin/watchtower.mjs scan examples/vulnerable               # exit 1, ~70 findings
node watchtower/bin/watchtower.mjs scan examples/hardened --fail-on info  # exit 0, no findings
node watchtower/bin/watchtower.mjs scan examples/vulnerable --format sarif --output vulnerable.sarif --fail-on none
```

## Compile check

Every example except `CUSTSQL.cbl` and `trojan_source.cob` compiles; the Watchtower test suite checks
it when the compilers are installed:

```sh
cobc -fsyntax-only -I examples/vulnerable examples/vulnerable/PAYROLL.cob
cobc -fsyntax-only examples/vulnerable/ACCTXFER.cbl
gfortran -fsyntax-only -ffixed-form examples/vulnerable/loancalc.f
gfortran -fsyntax-only -J /tmp examples/vulnerable/risk_engine.f90
```

(and the same for `examples/hardened/`). All COBOL examples are fixed format, so `-free` is not
needed. Excluded from the check:

- `CUSTSQL.cbl` contains `EXEC SQL` blocks and needs an SQL precompiler (IBM Db2 precompiler,
  `ocesql`, ...) before `cobc` can compile it.
- `trojan_source.cob` is a hostile sample: its homoglyph and zero-width identifiers are deliberately
  not valid names, and it must never be compiled or copied into real code.
