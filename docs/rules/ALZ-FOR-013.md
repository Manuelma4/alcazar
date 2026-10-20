# ALZ-FOR-013: Obsolescent control flow (arithmetic IF, computed or assigned GO TO)

| | |
|---|---|
| **Severity** | Low |
| **CWE** | [CWE-691: Insufficient Control Flow Management](https://cwe.mitre.org/data/definitions/691.html) |
| **Language** | Fortran |
| **Precision** | High |
| **SARIF name** | `ObsolescentControlFlow` |

Arithmetic IF, computed GO TO, assigned GO TO or ASSIGN is used.

## What Watchtower detects

Arithmetic IF (`IF (expr) 10, 20, 30`), computed GO TO (`GO TO (10, 20, 30) K`), assigned GO TO (`GO TO K`) and `ASSIGN 10 TO K`, also as the action of a logical IF. Plain `GO TO 10`, block IF and logical IF are not reported.

## Why it matters in legacy systems

These constructs jump to numeric labels chosen by an expression or a variable. An out-of-range index in a computed GO TO falls through silently, a stale label in an assigned GO TO jumps to the wrong code, and a NaN takes an unexpected branch of an arithmetic IF. They make old numerical codes very hard to review; arithmetic IF and ASSIGN are deleted features of modern Fortran.

## Vulnerable example

```fortran
      GO TO (10, 20, 30) LKIND
      IF (BALANCE - 1000000.0) 50, 50, 60
```

## Fixed example

```fortran
      SELECT CASE (LKIND)
      CASE (1)
         CALL AMORT(SCHED, NTERM, BALANCE, RATEBP, PAYMNT)
      CASE DEFAULT
         STOP 'UNKNOWN LOAN KIND'
      END SELECT
      IF (BALANCE .LE. 100000000) THEN
         WRITE (6, *) 'WITHIN LIMIT'
      END IF
```

## How to fix

Rewrite with IF / ELSE IF / END IF, SELECT CASE or procedure calls.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-013 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-691: Insufficient Control Flow Management](https://cwe.mitre.org/data/definitions/691.html)
- [Fortran 2018 standard, obsolescent and deleted features (ISO/IEC 1539-1:2018, Annex B)](https://wg5-fortran.org/f2018.html)
- [GNU Fortran documentation](https://gcc.gnu.org/onlinedocs/gfortran/)
