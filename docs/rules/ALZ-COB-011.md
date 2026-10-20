# ALZ-COB-011: Floating-point USAGE for a monetary field

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | [CWE-1339: Insufficient Precision or Accuracy of a Real Number](https://cwe.mitre.org/data/definitions/1339.html) |
| **Language** | COBOL |
| **Precision** | Medium |
| **SARIF name** | `FloatingPointMoney` |

A monetary field uses COMP-1, COMP-2 or FLOAT-* binary floating point.

## What Watchtower detects

Data items with USAGE `COMP-1`, `COMP-2`, `FLOAT-SHORT`, `FLOAT-LONG` or `FLOAT-EXTENDED` (and the `FLOAT-BINARY-*` spellings) whose name contains a strong money word (AMT, AMOUNT, BALANCE, FEE, INTEREST, PAY, PRICE, SALARY, TAX, CREDIT, DEBIT, CENTS). Decimal floating point (`FLOAT-DECIMAL-16/34`) is not reported.

## Why it matters in legacy systems

COMP-2 sneaks into financial code through "performance" changes and interfaces with C or Java. Binary floating point cannot hold 0.10 exactly, so year-to-date sums drift by cents, equality checks in reconciliation fail, and results differ between hardware and compilers. Regulators expect decimal arithmetic for money.

## Vulnerable example

```cobol
       01  WS-YTD-TAX                  USAGE COMP-2 VALUE 0.
```

## Fixed example

```cobol
       01  WS-YTD-TAX                  PIC 9(11)V99 COMP-3 VALUE 0.
```

## How to fix

Use fixed-point decimal: PIC S9(n)V99 with USAGE DISPLAY or COMP-3 / PACKED-DECIMAL, or integer cents in BINARY.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-011 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-1339: Insufficient Precision or Accuracy of a Real Number](https://cwe.mitre.org/data/definitions/1339.html)
- [What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html)
- [IBM Enterprise COBOL for z/OS Language Reference](https://www.ibm.com/docs/en/cobol-zos)
