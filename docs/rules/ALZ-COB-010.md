# ALZ-COB-010: Division without ON SIZE ERROR

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | [CWE-369: Divide By Zero](https://cwe.mitre.org/data/definitions/369.html) |
| **Language** | COBOL |
| **Precision** | Medium |
| **SARIF name** | `DivisionWithoutSizeError` |

DIVIDE, or COMPUTE with "/", has no ON SIZE ERROR phrase.

## What Watchtower detects

`DIVIDE`, and `COMPUTE` statements containing `/`, without a `SIZE ERROR` phrase, unless every divisor is a non-zero numeric literal. Such a statement is reported only under this rule, never also as ALZ-COB-009.

## Why it matters in legacy systems

A zero divisor coming from a parameter card, an empty master record or a corrupt file abends the job with S0CB on z/OS, stopping the whole batch chain; with some compiler options the receiver is simply left unchanged and processing goes on with yesterday's value. Either outcome can be triggered by whoever controls the divisor.

## Vulnerable example

```cobol
           DIVIDE EMP-ANNUAL-SALARY BY WS-PAY-PERIODS
               GIVING WS-PERIOD-PAY
```

## Fixed example

```cobol
           IF WS-PAY-PERIODS < 1 OR WS-PAY-PERIODS > 52
               PERFORM 9100-BAD-PARAMETERS
           END-IF
           DIVIDE EMP-ANNUAL-SALARY BY WS-PAY-PERIODS
               GIVING WS-PERIOD-PAY ROUNDED
               ON SIZE ERROR PERFORM 8000-REJECT-EMPLOYEE
           END-DIVIDE
```

## How to fix

Check the divisor before dividing and add ON SIZE ERROR with an explicit error path.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-010 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-369: Divide By Zero](https://cwe.mitre.org/data/definitions/369.html)
- [IBM Enterprise COBOL for z/OS Language Reference](https://www.ibm.com/docs/en/cobol-zos)
- [IBM: S0CB abend (decimal divide exception)](https://www.ibm.com/docs/en/zos)
