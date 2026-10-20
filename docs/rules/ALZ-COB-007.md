# ALZ-COB-007: Numeric truncation in MOVE

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | [CWE-197: Numeric Truncation Error](https://cwe.mitre.org/data/definitions/197.html) |
| **Language** | COBOL |
| **Precision** | High |
| **SARIF name** | `NumericTruncation` |

The receiving numeric field has fewer integer or decimal digits than the value moved into it.

## What Watchtower detects

Numeric `MOVE`s where the sender has more integer digits (high-order loss) or more decimal digits (low-order loss) than the receiver, including numeric-edited receivers (`PIC ZZ,ZZ9.99`), and numeric literals that cannot fit the receiver. The message shows the value actually stored for literals.

## Why it matters in legacy systems

Record layouts evolve: an amount field widened from 9(7)V99 to 9(11)V99 in the master file but not in a report or interface layout is truncated without any error. 1,234,567.89 printed as 34,567.89 on a statement, or posted to a downstream system, is both a data-integrity and an audit problem.

## Vulnerable example

```cobol
       01  WS-XFER-AMT                 PIC S9(9)V99.
       01  WS-AUDIT-AMT                PIC S9(5)V99.
      *    ...
           MOVE WS-XFER-AMT TO WS-AUDIT-AMT
```

## Fixed example

```cobol
       01  WS-XFER-AMT                 PIC S9(9)V99.
       01  WS-AUDIT-AMT                PIC S9(9)V99.
      *    ...
           MOVE WS-XFER-AMT TO WS-AUDIT-AMT
```

## How to fix

Size the receiver for the full range of the sender, or use COMPUTE ... ON SIZE ERROR to detect overflow, and ROUNDED when decimal places are reduced on purpose.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-007 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-197: Numeric Truncation Error](https://cwe.mitre.org/data/definitions/197.html)
- [IBM Enterprise COBOL for z/OS Language Reference](https://www.ibm.com/docs/en/cobol-zos)
