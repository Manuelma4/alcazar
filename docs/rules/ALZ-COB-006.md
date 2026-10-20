# ALZ-COB-006: Signed to unsigned MOVE (sign loss)

| | |
|---|---|
| **Severity** | High |
| **CWE** | [CWE-195: Signed to Unsigned Conversion Error](https://cwe.mitre.org/data/definitions/195.html) |
| **Language** | COBOL |
| **Precision** | High |
| **SARIF name** | `SignLossMove` |

A signed numeric value is moved into an unsigned numeric field, which silently drops the sign.

## What Watchtower detects

`MOVE source TO receiver...` where the source is a signed numeric item (PIC with `S`) and a receiver is an unsigned numeric item (no `S`), and `MOVE` of a negative numeric literal to an unsigned numeric item. Both items must be resolved in the DATA DIVISION symbol table (ambiguous names are skipped); reference-modified operands are alphanumeric moves and are ignored.

## Why it matters in legacy systems

COBOL silently stores the absolute value in an unsigned receiver. In payment systems debits are often carried as negative amounts, so a -500.00 reversal moved into an unsigned posting field becomes a +500.00 credit. It compiles cleanly, passes positive-only test data, and has been used in real ledger frauds.

## Vulnerable example

```cobol
       01  WS-XFER-AMT                 PIC S9(9)V99.
       01  WS-POSTED-AMT               PIC 9(9)V99.
      *    ...
           MOVE WS-XFER-AMT TO WS-POSTED-AMT
```

## Fixed example

```cobol
       01  WS-XFER-AMT                 PIC S9(9)V99.
       01  WS-POSTED-AMT               PIC S9(9)V99.
      *    ...
           IF WS-XFER-AMT NOT > 0
               PERFORM 8000-REJECT-TRANSFER
           END-IF
           MOVE WS-XFER-AMT TO WS-POSTED-AMT
```

## How to fix

Give the receiver a signed PICTURE (PIC S9(n)V99), or test the sign explicitly (IF WS-AMT < 0 ...) and reject or route negative values before the MOVE.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-006 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-195: Signed to Unsigned Conversion Error](https://cwe.mitre.org/data/definitions/195.html)
- [IBM Enterprise COBOL for z/OS Language Reference](https://www.ibm.com/docs/en/cobol-zos)
- [GnuCOBOL Programmer's Guide](https://gnucobol.sourceforge.io/doc/gnucobol.html)
