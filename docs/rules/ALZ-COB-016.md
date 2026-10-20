# ALZ-COB-016: LINE SEQUENTIAL input without record-length check

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | [CWE-130: Improper Handling of Length Parameter Inconsistency](https://cwe.mitre.org/data/definitions/130.html) |
| **Language** | COBOL |
| **Precision** | Medium |
| **SARIF name** | `LineSequentialRecordLength` |

A LINE SEQUENTIAL file is read but its FILE STATUS is never tested for 04/06 (record length mismatch).

## What Watchtower detects

A `SELECT ... ORGANIZATION [IS] LINE SEQUENTIAL` file with a FILE STATUS item that is opened `INPUT` or `I-O`, when the PROCEDURE DIVISION never compares that status item with `"04"` or `"06"`: not in an `IF` near the item, not in an `EVALUATE` on it, and not through an 88-level on it with those values. Files without FILE STATUS are reported by ALZ-COB-012 only.

## Why it matters in legacy systems

Measured on GnuCOBOL 3.2: when a LINE SEQUENTIAL line is longer than the FD record, `READ` returns status 06 for the first part and then returns the rest of the line as a separate record with status 00 (`COB_LS_SPLIT`). A program that only distinguishes 00 and 10 therefore processes an attacker-shaped second record: one crafted line in an upload becomes two transactions. With ORGANIZATION SEQUENTIAL, a short final record also returns status 00 while the record area keeps stale bytes from the previous record.

## Vulnerable example

```cobol
           SELECT XFER-IN ASSIGN TO "XFERIN.DAT"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-XFER-FS.
      *    ...
           READ XFER-IN
               AT END SET XFER-EOF TO TRUE
           END-READ
```

## Fixed example

```cobol
       01  WS-XFER-FS                  PIC XX.
           88  XFER-OK                 VALUE "00".
           88  XFER-LENGTH-ERROR       VALUE "04" "06".
           88  XFER-EOF                VALUE "10".
      *    ...
           MOVE LOW-VALUES TO XFER-IN-REC
           READ XFER-IN
               AT END SET XFER-EOF TO TRUE
           END-READ
           EVALUATE TRUE
               WHEN XFER-LENGTH-ERROR
      *            Reject the record; after 06 also drop its split tail.
                   IF WS-XFER-FS = "06"
                       SET SKIP-TAIL TO TRUE
                   END-IF
                   PERFORM 8100-REJECT-RECORD
               WHEN XFER-OK AND SKIP-TAIL
                   MOVE "N" TO WS-SKIP-TAIL
               WHEN XFER-OK
                   PERFORM 2000-PROCESS-TRANSFER
           END-EVALUATE
```

## How to fix

Use fixed-length ORGANIZATION SEQUENTIAL for untrusted input, pre-fill the record area with LOW-VALUES before each READ (a short final record otherwise keeps stale bytes), and treat status 04/06 as a rejected record.

## Notes and limitations

The rule looks for the literals "04"/"06" within a few tokens of the status item, in `WHEN` branches of an `EVALUATE` on the item, and in 88-levels on the item that are referenced. A comparison through a group or a differently named alias is not recognised. For untrusted input, fixed-length ORGANIZATION SEQUENTIAL records are the safer choice.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-016 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-130: Improper Handling of Length Parameter Inconsistency](https://cwe.mitre.org/data/definitions/130.html)
- [GnuCOBOL Programmer's Guide](https://gnucobol.sourceforge.io/doc/gnucobol.html)
- [GnuCOBOL runtime configuration (COB_LS_SPLIT, COB_LS_VALIDATE)](https://gnucobol.sourceforge.io/doc/gnucobol.html)
