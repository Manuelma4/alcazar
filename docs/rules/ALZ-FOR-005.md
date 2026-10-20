# ALZ-FOR-005: Floating-point equality comparison

| | |
|---|---|
| **Severity** | Low |
| **CWE** | [CWE-1077: Floating Point Comparison with Incorrect Operator](https://cwe.mitre.org/data/definitions/1077.html) |
| **Language** | Fortran |
| **Precision** | Medium |
| **SARIF name** | `FloatEquality` |

A value is compared for exact equality with a real literal.

## What Watchtower detects

`==`, `.eq.`, `/=` and `.ne.` where one operand is a real literal: a literal with a decimal point or an exponent (`0.0`, `0.`, `1.d0`, `1e-3`, `0.0_dp`). Integer literals, including kind-suffixed ones such as `0_int64`, are not reported.

## Why it matters in legacy systems

Guards such as `IF (RATE .EQ. 0.0)` before a division, or `IF (BALANCE .EQ. 0.0)` to close an account, depend on exact binary results. After a few operations the value is 1.0E-9 instead of zero, the guard misfires and the program divides by a tiny number or keeps an account open forever.

## Vulnerable example

```fortran
      IF (RATE .EQ. 0.0) THEN
         PAYMENT = BALANCE / NTERM
      END IF
```

## Fixed example

```fortran
      IF (RATEBP .EQ. 0) THEN
         PAYMNT = (BALANCE + NTERM - 1) / NTERM
      END IF
```

## How to fix

Compare with a tolerance (abs(x - y) <= tol, scaled by epsilon() or spacing()), or use integer or fixed-point representations for exact quantities such as money.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-005 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-1077: Floating Point Comparison with Incorrect Operator](https://cwe.mitre.org/data/definitions/1077.html)
- [What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html)
- [gfortran -Wcompare-reals](https://gcc.gnu.org/onlinedocs/gfortran/Error-and-Warning-Options.html)
