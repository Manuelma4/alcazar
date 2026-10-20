# ALZ-FOR-006: I/O statement without IOSTAT=

| | |
|---|---|
| **Severity** | Low |
| **CWE** | [CWE-252: Unchecked Return Value](https://cwe.mitre.org/data/definitions/252.html) |
| **Language** | Fortran |
| **Precision** | High |
| **SARIF name** | `MissingIostat` |

OPEN or READ (or WRITE, CLOSE, INQUIRE on a file) has no IOSTAT= to report errors.

## What Watchtower detects

`OPEN` and `READ` (including the short form `read *, x` and internal reads) without `iostat=`, always; `WRITE`, `CLOSE` and `INQUIRE` without `iostat=` when the unit is not `*`, `output_unit`, `error_unit`, `stdout`, `stderr`, 6 or 0. `ERR=`/`END=` without `iostat=` is still reported. An internal `WRITE` into a character variable declared in scope is exempt, and so is `inquire(iolength=...)`.

## Why it matters in legacy systems

Batch Fortran jobs read files produced by other systems. Without `iostat=` a truncated record, a missing file or a full disk terminates the program with a runtime error, often after half of the output was written, or, with only `ERR=`/`END=` labels, the cause is lost and some paths carry on with undefined variables.

## Vulnerable example

```fortran
      OPEN (UNIT=10, FILE='LOANS.DAT', STATUS='OLD')
      READ (10, 100) BALANCE, RATE, NTERM
```

## Fixed example

```fortran
      OPEN (UNIT=10, FILE='LOANS.DAT', STATUS='OLD', IOSTAT=IOS)
      IF (IOS .NE. 0) STOP 'LOANS.DAT: OPEN FAILED'
      READ (10, 100, IOSTAT=IOS) BALANCE, RATEBP, NTERM
      IF (IOS .NE. 0) STOP 'LOANS.DAT: BAD RECORD'
```

## How to fix

Add iostat=ios (and iomsg=msg) to every OPEN, READ, WRITE, CLOSE and INQUIRE on files and check ios after the statement.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-006 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-252: Unchecked Return Value](https://cwe.mitre.org/data/definitions/252.html)
- [GNU Fortran documentation](https://gcc.gnu.org/onlinedocs/gfortran/)
- [gfortran runtime error codes](https://gcc.gnu.org/onlinedocs/gfortran/Runtime.html)
