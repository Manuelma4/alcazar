# ALZ-COB-005: Sensitive data written with DISPLAY

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | [CWE-532: Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html) |
| **Language** | COBOL |
| **Precision** | Medium |
| **SARIF name** | `SensitiveDisplay` |

DISPLAY prints a field that looks like a card number, CVV, PIN, password, IBAN or token.

## What Watchtower detects

A `DISPLAY` operand (including arguments of `FUNCTION` calls such as `FUNCTION TRIM(...)`) whose name, split on hyphens, contains PAN, CARD-NUM / CARD-NO / CARDNO / CCNUM, CVV / CVC, SSN, PASSWORD / PASSWD, PIN (as a word: SPINDLE is not a PIN), IBAN, SECRET or TOKEN. Masked or metadata names (`-MASKED`, `-LAST4`, `-LEN`, `-STATUS`, `-TRIES`...), reference-modified operands (`WS-PAN(1:6)`, the usual masking idiom), `LENGTH OF` and `FUNCTION LENGTH(...)` are not reported.

## Why it matters in legacy systems

On z/OS, DISPLAY goes to SYSOUT; on distributed platforms to stdout captured by the scheduler. Those job logs are archived for years, browsed by operators and shipped to log platforms, which puts primary account numbers and PINs in scope of PCI DSS requirement 3 everywhere the logs travel.

## Vulnerable example

```cobol
           DISPLAY "XFER " IN-FROM-ACCT " CARD " IN-CARD-PAN
```

## Fixed example

```cobol
           MOVE ALL "*" TO WS-PAN-MASKED
           MOVE IN-CARD-PAN(1:6) TO WS-PAN-MASKED(1:6)
           MOVE IN-CARD-PAN(13:4) TO WS-PAN-MASKED(13:4)
           DISPLAY "XFER " IN-FROM-ACCT " CARD " WS-PAN-MASKED
```

## How to fix

Never display secrets. Display a masked value (BIN and last four digits), a reference id or a keyed hash, and route diagnostics through a routine that redacts.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-005 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-532: Insertion of Sensitive Information into Log File](https://cwe.mitre.org/data/definitions/532.html)
- [PCI DSS v4.0 (requirement 3: protect stored account data)](https://www.pcisecuritystandards.org/document_library/)
- [OWASP: Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
