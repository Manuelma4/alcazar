# ALZ-FOR-011: Format string taken from a variable

| | |
|---|---|
| **Severity** | Low |
| **CWE** | [CWE-134: Use of Externally-Controlled Format String](https://cwe.mitre.org/data/definitions/134.html) |
| **Language** | Fortran |
| **Precision** | Medium |
| **SARIF name** | `RuntimeFormatString` |

A READ, WRITE or PRINT format comes from a character variable rather than a literal or PARAMETER.

## What Watchtower detects

A `READ`/`WRITE` whose format (`fmt=` or the second positional item) is a character variable, and `PRINT fmt, ...` / `READ fmt, ...` with such a variable, when the variable is declared in the procedure or its host and is not a `PARAMETER`. Literals, labels, `*`, namelists and use-associated names (whose nature is unknown) are not reported.

## Why it matters in legacy systems

Formats read from configuration or input files ("the report layout is in line 1 of the file") let whoever controls that file change field widths and repeat counts: records are misparsed, values are printed into adjacent columns, or the program aborts on a malformed descriptor in the middle of a batch.

## Vulnerable example

```fortran
    read (u, '(a)') row_fmt
    write (out, row_fmt) n, exposure_amount
```

## Fixed example

```fortran
  character(len=*), parameter :: ROW_FMT = '(i8, 1x, i15)'
  ! ...
    write (out, ROW_FMT, iostat=ios) n, exposure_cents
```

## How to fix

Use literal formats or character PARAMETER constants; if a format must be computed, build it only from validated integers.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-011 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-134: Use of Externally-Controlled Format String](https://cwe.mitre.org/data/definitions/134.html)
- [GNU Fortran documentation](https://gcc.gnu.org/onlinedocs/gfortran/)
- [CWE-134: Use of Externally-Controlled Format String](https://cwe.mitre.org/data/definitions/134.html)
