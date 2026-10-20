# ALZ-FOR-007: OS command execution

| | |
|---|---|
| **Severity** | High (medium when the command is a literal) |
| **CWE** | [CWE-78: Improper Neutralization of Special Elements used in an OS Command ('OS Command Injection')](https://cwe.mitre.org/data/definitions/78.html) |
| **Language** | Fortran |
| **Precision** | High |
| **SARIF name** | `CommandExecution` |

execute_command_line or CALL SYSTEM runs a shell command.

## What Watchtower detects

`call execute_command_line(...)` and `call system(...)`: **high** when the command (first argument or `command=`) is a variable or an expression, **medium** when it is a string literal.

## Why it matters in legacy systems

Scientific and risk codes call the shell to compress outputs, move files or launch post-processing. Report paths and identifiers concatenated into the command come from job parameters or input files, so a crafted name such as `x; rm -rf ~` runs with the job's privileges.

## Vulnerable example

```fortran
    call execute_command_line('gzip -f ' // trim(report_path))
```

## Fixed example

```fortran
    ! No shell: leave compression to the job scheduler, or call a library
    ! routine through bind(c) with arguments passed as data.
    close (out, iostat=ios)
```

## How to fix

Avoid shelling out and use library routines instead. If a command is unavoidable, use a fixed literal, never interpolate input, and validate any argument against a strict allowlist.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-007 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-78: Improper Neutralization of Special Elements used in an OS Command ('OS Command Injection')](https://cwe.mitre.org/data/definitions/78.html)
- [OWASP: OS Command Injection Defense Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OS_Command_Injection_Defense_Cheat_Sheet.html)
- [gfortran EXECUTE_COMMAND_LINE](https://gcc.gnu.org/onlinedocs/gfortran/EXECUTE_005fCOMMAND_005fLINE.html)
