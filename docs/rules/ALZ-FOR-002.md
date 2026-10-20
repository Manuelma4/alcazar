# ALZ-FOR-002: Assumed-size dummy array

| | |
|---|---|
| **Severity** | Medium (info inside BIND(C) procedures) |
| **CWE** | [CWE-119: Improper Restriction of Operations within the Bounds of a Memory Buffer](https://cwe.mitre.org/data/definitions/119.html) |
| **Language** | Fortran |
| **Precision** | High |
| **SARIF name** | `AssumedSizeArray` |

A dummy argument is declared assumed-size (x(*)), so the procedure cannot know its extent.

## What Watchtower detects

A dummy argument declared assumed-size: `x(*)`, `x(n, *)`, `x(lb:*)` or `dimension(*)`. Assumed-length characters (`character(len=*)`), assumed-shape arrays (`x(:)`), implied-shape PARAMETER arrays and local arrays are not reported. Inside a `BIND(C)` procedure the finding is downgraded to **info** ("C interop requires assumed-size; validate the explicit length argument"), because C interoperability needs that form.

## Why it matters in legacy systems

F77 libraries pass arrays as `A(*)` or `A(1)` and trust a separate length argument. Neither the compiler nor `-fcheck=bounds` can check the last dimension, so an index derived from a record count or a file header writes past the caller's buffer, corrupting adjacent COMMON storage or the stack.

## Vulnerable example

```fortran
      SUBROUTINE AMORT(SCHED, N, PAYMENT)
      REAL*4 SCHED(*)
      INTEGER N, I
      DO 10 I = 1, N
         SCHED(I) = 0.0
   10 CONTINUE
      END
```

## Fixed example

```fortran
      SUBROUTINE AMORT(SCHED, N)
      IMPLICIT NONE
      INTEGER N, I
      INTEGER(KIND=8) SCHED(N)
      DO 10 I = 1, N
         SCHED(I) = 0
   10 CONTINUE
      END
```

## How to fix

Use assumed-shape arrays (x(:)) with an explicit interface, or pass the length and declare x(n). In BIND(C) procedures, where assumed-size is required, validate the explicit length argument before every access.

## Notes and limitations

For BIND(C) entry points the info finding is expected: validate the length argument against a maximum before every access and document it with a suppression, for example `! watchtower-ignore ALZ-FOR-002 -- n is range-checked against MAX_RECORD first`.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-002 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-119: Improper Restriction of Operations within the Bounds of a Memory Buffer](https://cwe.mitre.org/data/definitions/119.html)
- [GNU Fortran documentation](https://gcc.gnu.org/onlinedocs/gfortran/)
- [gfortran -fcheck=bounds](https://gcc.gnu.org/onlinedocs/gfortran/Code-Gen-Options.html)
