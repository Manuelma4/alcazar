# ALZ-FOR-003: EQUIVALENCE storage aliasing

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | [CWE-843: Access of Resource Using Incompatible Type ('Type Confusion')](https://cwe.mitre.org/data/definitions/843.html) |
| **Language** | Fortran |
| **Precision** | High |
| **SARIF name** | `Equivalence` |

EQUIVALENCE overlays different variables on the same storage.

## What Watchtower detects

Every `EQUIVALENCE` statement (a variable named `equivalence` in an assignment is not confused with it).

## Why it matters in legacy systems

EQUIVALENCE was used to save memory and to reinterpret bytes, for example an INTEGER overlaid on a REAL to inspect its bits, or record buffers overlaid on numeric fields. Writing one name silently changes the other with a different type interpretation, defeats optimisation and bounds checks, and is a source of type-confusion bugs. It is obsolescent in Fortran 2018.

## Vulnerable example

```fortran
      REAL*4 PAYMENT
      EQUIVALENCE (PAYMENT, IPAYBITS)
```

## Fixed example

```fortran
      real(real64) :: payment
      integer(int64) :: bits
      bits = transfer(payment, bits)   ! explicit, visible reinterpretation
```

## How to fix

Remove EQUIVALENCE: use separate variables, TRANSFER() for explicit reinterpretation, or derived types and pointers where sharing is intended.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-003 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-843: Access of Resource Using Incompatible Type ('Type Confusion')](https://cwe.mitre.org/data/definitions/843.html)
- [Fortran 2018 standard, obsolescent and deleted features (ISO/IEC 1539-1:2018, Annex B)](https://wg5-fortran.org/f2018.html)
- [GNU Fortran documentation](https://gcc.gnu.org/onlinedocs/gfortran/)
