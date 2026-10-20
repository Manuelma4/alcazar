# ALZ-FOR-004: COMMON block (unchecked global storage)

| | |
|---|---|
| **Severity** | Low |
| **CWE** | [CWE-1108: Excessive Reliance on Global Variables](https://cwe.mitre.org/data/definitions/1108.html) |
| **Language** | Fortran |
| **Precision** | High |
| **SARIF name** | `CommonBlock` |

COMMON shares unchecked global storage between program units.

## What Watchtower detects

Every `COMMON` statement, named (`COMMON /LOANDB/ ...`) or blank.

## Why it matters in legacy systems

Each program unit re-declares the layout of a COMMON block, and nothing checks that the declarations agree. Adding one variable in one routine shifts every following field in all others, so a balance is read from what is now the rate. COMMON also makes procedures non-reentrant, which breaks when the code is called from threads or from a service.

## Vulnerable example

```fortran
      COMMON /LOANDB/ BALANCE, RATE, NTERM
```

## Fixed example

```fortran
module loan_state
  use, intrinsic :: iso_fortran_env, only: int64
  implicit none
  private
  integer(int64), public, protected :: balance_cents = 0
end module loan_state
```

## How to fix

Move shared data into a MODULE with explicit typed declarations (PRIVATE/PROTECTED where possible), or pass it as arguments.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-004 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-1108: Excessive Reliance on Global Variables](https://cwe.mitre.org/data/definitions/1108.html)
- [Fortran 2018 standard, obsolescent and deleted features (ISO/IEC 1539-1:2018, Annex B)](https://wg5-fortran.org/f2018.html)
- [GNU Fortran documentation](https://gcc.gnu.org/onlinedocs/gfortran/)
