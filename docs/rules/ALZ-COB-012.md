# ALZ-COB-012: File without FILE STATUS

| | |
|---|---|
| **Severity** | Low |
| **CWE** | [CWE-252: Unchecked Return Value](https://cwe.mitre.org/data/definitions/252.html) |
| **Language** | COBOL |
| **Precision** | High |
| **SARIF name** | `MissingFileStatus` |

A SELECT has no FILE STATUS clause, so I/O errors cannot be detected.

## What Watchtower detects

A `SELECT` entry in FILE-CONTROL without a `FILE STATUS` (or `STATUS`) clause. Sort/merge work files (described with `SD`) are exempt.

## Why it matters in legacy systems

Without a status field the program cannot react to a missing dataset, a full disk, a duplicate key or a short record: depending on the runtime it abends or simply continues. In batch chains that means a downstream job processes a partial file, or the audit trail silently stops being written.

## Vulnerable example

```cobol
           SELECT XFER-LOG ASSIGN TO "XFERLOG.DAT"
               ORGANIZATION IS LINE SEQUENTIAL.
```

## Fixed example

```cobol
           SELECT XFER-LOG ASSIGN TO "XFERLOG.DAT"
               ORGANIZATION IS LINE SEQUENTIAL
               FILE STATUS IS WS-LOG-FS.
      *    ...
           WRITE XFER-LOG-REC
           IF NOT LOG-OK
               MOVE 16 TO WS-RETURN-CODE
           END-IF
```

## How to fix

Add FILE STATUS IS WS-<file>-FS to every SELECT and check it after each OPEN, READ, WRITE, REWRITE, DELETE and CLOSE.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-012 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-252: Unchecked Return Value](https://cwe.mitre.org/data/definitions/252.html)
- [GnuCOBOL Programmer's Guide](https://gnucobol.sourceforge.io/doc/gnucobol.html)
- [IBM Enterprise COBOL for z/OS Language Reference](https://www.ibm.com/docs/en/cobol-zos)
