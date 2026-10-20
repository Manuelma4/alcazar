# ALZ-COB-001: Dynamic CALL target from a data item

| | |
|---|---|
| **Severity** | High |
| **CWE** | [CWE-470: Use of Externally-Controlled Input to Select Classes or Code ('Unsafe Reflection')](https://cwe.mitre.org/data/definitions/470.html) |
| **Language** | COBOL |
| **Precision** | High |
| **SARIF name** | `DynamicCallTarget` |

CALL takes the program name from a data item, so the program that runs is chosen at run time.

## What Watchtower detects

A `CALL` statement whose target is an identifier (`CALL WS-PGM`) instead of a literal (`CALL "PGM"`). `CALL` statements inside `EXEC ... END-EXEC` blocks are ignored. When the item has a `VALUE` of `"SYSTEM"`, ALZ-COB-002 is reported as well.

## Why it matters in legacy systems

Batch suites often pick a module by name from a parameter card or an input record ("plug-in" fraud checks, per-country rating routines). On z/OS the name is looked up in STEPLIB/JOBLIB at run time; on GnuCOBOL in `COB_LIBRARY_PATH`. Whoever controls the field, or can overlay it through a buffer overrun in the same WORKING-STORAGE, chooses which program runs with the job's RACF identity, and the call graph used in change reviews no longer shows the real control flow.

## Vulnerable example

```cobol
           MOVE IN-ROUTE-CODE TO WS-FRAUD-PGM
           CALL WS-FRAUD-PGM USING XFER-IN-REC WS-FRAUD-RC
```

## Fixed example

```cobol
           EVALUATE IN-ROUTE-CODE
               WHEN "STANDARD"
                   CALL "FRAUDCHK" USING XFER-IN-REC WS-FRAUD-RC
               WHEN "PRIORITY"
                   CALL "FRAUDPRI" USING XFER-IN-REC WS-FRAUD-RC
               WHEN OTHER
                   PERFORM 8000-REJECT-TRANSFER
           END-EVALUATE
```

## How to fix

Call programs by literal name (CALL "FRAUDCHK"); when a choice is needed, map validated codes to literal CALLs through an EVALUATE allowlist, and compile with -fstatic-call (GnuCOBOL) or NODYNAM (IBM).

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-001 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-470: Use of Externally-Controlled Input to Select Classes or Code ('Unsafe Reflection')](https://cwe.mitre.org/data/definitions/470.html)
- [GnuCOBOL Programmer's Guide](https://gnucobol.sourceforge.io/doc/gnucobol.html)
- [GnuCOBOL -fstatic-call option](https://gnucobol.sourceforge.io/doc/gnucobol.html#Compiler-Options)
- [IBM Enterprise COBOL for z/OS Language Reference](https://www.ibm.com/docs/en/cobol-zos)
