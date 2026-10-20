# ALZ-COB-013: Monetary multiplication or division without ROUNDED

| | |
|---|---|
| **Severity** | Low |
| **CWE** | [CWE-682: Incorrect Calculation](https://cwe.mitre.org/data/definitions/682.html) |
| **Language** | COBOL |
| **Precision** | Medium |
| **SARIF name** | `MissingRounded` |

A monetary result with decimal places is computed with * or / but without ROUNDED.

## What Watchtower detects

`MULTIPLY`, `DIVIDE`, and `COMPUTE` with `*`, `/` or `**`, into a money-named receiver that has decimal places, without `ROUNDED`. Products are skipped when the operands' decimal places cannot exceed the receiver's (for example quantity 9(3) times price 9(5)V99 into V99).

## Why it matters in legacy systems

Truncation always loses in the same direction. Interest, fee or FX calculations over millions of accounts drop up to a cent each; diverting those fractions is the classic "salami slicing" fraud, and even without fraud the results disagree with the bank's published rounding rule.

## Vulnerable example

```cobol
           COMPUTE WS-FEE-AMT = WS-XFER-AMT * 0.0025
```

## Fixed example

```cobol
           COMPUTE WS-FEE-AMT ROUNDED = WS-XFER-AMT * 0.0025
               ON SIZE ERROR PERFORM 8000-REJECT-TRANSFER
           END-COMPUTE
```

## How to fix

Add ROUNDED (or ROUNDED MODE IS NEAREST-EVEN where supported) to every monetary receiver of MULTIPLY, DIVIDE and COMPUTE with * or /.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-013 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-682: Incorrect Calculation](https://cwe.mitre.org/data/definitions/682.html)
- [IBM Enterprise COBOL for z/OS Language Reference](https://www.ibm.com/docs/en/cobol-zos)
- [Salami slicing (fraud technique)](https://en.wikipedia.org/wiki/Salami_slicing_tactics)
