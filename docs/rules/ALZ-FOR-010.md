# ALZ-FOR-010: Single-precision REAL for money

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | [CWE-1339: Insufficient Precision or Accuracy of a Real Number](https://cwe.mitre.org/data/definitions/1339.html) |
| **Language** | Fortran |
| **Precision** | Medium |
| **SARIF name** | `SinglePrecisionMoney` |

A monetary variable is declared as default or single-precision REAL.

## What Watchtower detects

A REAL entity of default or single precision (`real`, `real*4`, `real(4)`, `real(kind=4)`, `real(sp)`, `real(real32)`, `real(c_float)`) whose name contains amount, balance, price, fee, interest, salary, tax, payment or cents, and single-precision REAL functions with such names. Generic words such as `total` or `cost` (cost functions) are not enough on their own.

## Why it matters in legacy systems

Single precision holds about 7 significant decimal digits: 123,456.78 is already at the limit and anything above loses cents. Loan and interest programs written for REAL*4 in the 1980s still run, and their monthly accruals drift by real money, differently on each compiler and optimisation level.

## Vulnerable example

```fortran
      REAL*4 BALANCE, PAYMENT, INTEREST
```

## Fixed example

```fortran
      INTEGER(KIND=8) BALANCE, PAYMNT, INTRST   ! integer cents
```

## How to fix

Store money as integer cents (integer(int64)) or compute in real(real64) with explicit rounding to cents at defined points.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-010 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-1339: Insufficient Precision or Accuracy of a Real Number](https://cwe.mitre.org/data/definitions/1339.html)
- [IEEE 754 binary32 precision](https://en.wikipedia.org/wiki/Single-precision_floating-point_format)
- [GNU Fortran documentation](https://gcc.gnu.org/onlinedocs/gfortran/)
