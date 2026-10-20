# ALZ-FOR-014: Bounds check not short-circuited

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | [CWE-125: Out-of-bounds Read](https://cwe.mitre.org/data/definitions/125.html) |
| **Language** | Fortran |
| **Precision** | Medium |
| **SARIF name** | `BoundsCheckNotShortCircuited` |

A condition combines an index bound check and an access with that index in the same .and./.or. chain.

## What Watchtower detects

An `IF`, `ELSE IF` or `DO WHILE` condition, or a logical assignment, in which one operand of an `.and.`/`.or.` chain compares an integer index (`i`, or `i + 1`) with a bound (a name, a literal, `size()`, `len()`, `len_trim()`, `ubound()`...) and another operand of the same chain subscripts an array or substring with that index (`a(i)`, `a(i + 1)`, `s(i:i)`). Only names declared in scope as arrays or character variables count: an unknown name may be a function call, and Watchtower prefers no finding when unsure.

## Why it matters in legacy systems

C and COBOL programmers expect `if (i <= n .and. a(i) > 0)` to stop at the first false operand, but Fortran does not guarantee short-circuit evaluation: compilers may evaluate `a(i)` first or both operands. The guard looks right in review while the program reads past the array (or aborts under `-fcheck=bounds`) exactly for the boundary case it was meant to protect.

## Vulnerable example

```fortran
      do while (i <= len_trim(line) .and. line(i:i) == ' ')
        i = i + 1
      end do
```

## Fixed example

```fortran
      do k = 1, len_trim(text)
        if (text(k:k) /= ' ') then
          pos = k
          return
        end if
      end do
```

## How to fix

Nest the conditions (if (i <= n) then; if (a(i) > 0) ...), or use merge() only when both arms are safe to evaluate.

## Notes and limitations

Nested IF statements are the portable fix. `merge()` evaluates all of its arguments, so it is only safe when both arms are valid for every index.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-014 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-125: Out-of-bounds Read](https://cwe.mitre.org/data/definitions/125.html)
- [Fortran 2018 standard, 10.1.7 evaluation of operands](https://wg5-fortran.org/f2018.html)
- [gfortran -fcheck=bounds](https://gcc.gnu.org/onlinedocs/gfortran/Code-Gen-Options.html)
