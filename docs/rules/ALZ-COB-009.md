# ALZ-COB-009: Monetary arithmetic without ON SIZE ERROR

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | [CWE-190: Integer Overflow or Wraparound](https://cwe.mitre.org/data/definitions/190.html) |
| **Language** | COBOL |
| **Precision** | Medium |
| **SARIF name** | `ArithmeticWithoutSizeError` |

Arithmetic into a monetary field can overflow and has no ON SIZE ERROR phrase.

## What Watchtower detects

`ADD`, `SUBTRACT`, `MULTIPLY`, `DIVIDE` and `COMPUTE` into a receiver whose name looks monetary, when the statement (from the verb to the next verb, scope terminator or period) contains no `SIZE ERROR` phrase. Strong money words (AMT, AMOUNT, BAL, BALANCE, PRICE, FEE, INTEREST, PAY, SALARY, TAX, CREDIT, DEBIT, CENTS) always count. TOTAL, SUM, RATE and LIMIT count only for fields with decimal places, because a `TOTAL` or `SUM` without cents is usually a counter or a check digit sum.

Watchtower skips the finding when it can prove that the result fits. For example, it bounds `COMPUTE WS-CENTS = WS-INT * 100 + WS-DEC` from the operand PICTUREs. For `DIVIDE` by a nonzero literal it compares the quotient to the receiving PICTURE, with a conservative capacity check when `ROUNDED` could carry into the integer part. A `REMAINDER` field is outside this quotient check. ALZ-COB-010 covers divisors that may be zero, and ALZ-COB-011 covers floating-point receivers.

## Why it matters in legacy systems

When a result does not fit, COBOL keeps the low-order digits (or, with some options, leaves the receiver unchanged) and continues. Totals that overflow at year end, balances that wrap at 99,999.99, interest accruals that silently drop millions: these are found by reconciliation weeks later, if at all.

## Vulnerable example

```cobol
           ADD WS-GROSS-PAY TO WS-TOTAL-GROSS
```

## Fixed example

```cobol
           ADD WS-GROSS-PAY TO WS-TOTAL-GROSS
               ON SIZE ERROR PERFORM 8000-REJECT-EMPLOYEE
           END-ADD
```

## How to fix

Add ON SIZE ERROR (and NOT ON SIZE ERROR) with explicit handling (reject the transaction, alert, set a return code), and size receivers for the largest expected value.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-009 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-190: Integer Overflow or Wraparound](https://cwe.mitre.org/data/definitions/190.html)
- [IBM Enterprise COBOL for z/OS Language Reference](https://www.ibm.com/docs/en/cobol-zos)
- [GnuCOBOL Programmer's Guide](https://gnucobol.sourceforge.io/doc/gnucobol.html)
