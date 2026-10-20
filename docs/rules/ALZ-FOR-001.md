# ALZ-FOR-001: Missing IMPLICIT NONE

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | [CWE-457: Use of Uninitialized Variable](https://cwe.mitre.org/data/definitions/457.html) |
| **Language** | Fortran |
| **Precision** | High |
| **SARIF name** | `MissingImplicitNone` |

A program unit relies on implicit typing.

## What Watchtower detects

A program unit that never executes `IMPLICIT NONE`: main programs (including an implicit main program with no `PROGRAM` statement), modules, submodules, external subroutines and functions, and block data. Module procedures and internal procedures inherit the host's implicit rules and are not reported; interface bodies are skipped. `implicit none (type)` and `implicit none (type, external)` are accepted, `implicit none (external)` alone is not (it does not disable implicit typing).

## Why it matters in legacy systems

FORTRAN 77 risk and actuarial codes routinely rely on the I-N rule. A typo such as `BALNCE = BALNCE + PAYMNT` silently creates two uninitialised REAL variables, and a money field named `IAMOUNT` becomes an INTEGER that drops the cents. These bugs survive decades because the program still produces plausible numbers.

## Vulnerable example

```fortran
      PROGRAM LOANCALC
      REAL*4 BALANCE, RATE, PAYMENT
      BALNCE = BALANCE - PAYMENT
      END
```

## Fixed example

```fortran
      PROGRAM LOANCALC
      IMPLICIT NONE
      INTEGER(KIND=8) BALANCE, PAYMNT
      BALANCE = BALANCE - PAYMNT
      END
```

## How to fix

Add IMPLICIT NONE (or implicit none (type, external)) to every program, module, submodule, external procedure and block data unit, and declare every variable.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-001 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-457: Use of Uninitialized Variable](https://cwe.mitre.org/data/definitions/457.html)
- [GNU Fortran documentation](https://gcc.gnu.org/onlinedocs/gfortran/)
- [gfortran -fimplicit-none](https://gcc.gnu.org/onlinedocs/gfortran/Fortran-Dialect-Options.html)
