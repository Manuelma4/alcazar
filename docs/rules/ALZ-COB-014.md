# ALZ-COB-014: Code-like text beyond column 72

| | |
|---|---|
| **Severity** | Medium |
| **CWE** | [CWE-561: Dead Code](https://cwe.mitre.org/data/definitions/561.html) |
| **Language** | COBOL |
| **Precision** | Medium |
| **SARIF name** | `CodePastColumn72` |

Fixed-format text in columns 73+ looks like code, but the compiler ignores it.

## What Watchtower detects

In fixed-format source, text in columns 73-80 of a code line that looks like code: it contains a quote, `=`, `<` or `>`, a lone separator period, a COBOL verb or keyword (MOVE, IF, AND, OR, NOT, TO, ...), or several words one of which ends a sentence. Sequence numbers and change tags such as `00012300`, `CHG0042` or `PAYR0010` are not reported, and neither is text that follows an inline `*>` comment.

## Why it matters in legacy systems

The identification area dates back to punched cards: compilers ignore it. An editor or a code review tool, however, shows it on the same line as the code, so a condition such as `OR WS-WATCHLIST-HIT = "Y"` or the period that ends an `IF` can look present while the compiled program never checks it. This is a known way to hide a backdoor or an accidental logic change in a reviewed program.

## Vulnerable example

```cobol
      *  The OR clause starts in column 73 and is never compiled.
           IF WS-XFER-AMT > WS-DAILY-LIMIT                              OR WS-WATCHLIST-HIT = "Y"
               PERFORM 8000-REJECT-TRANSFER
           END-IF
```

## Fixed example

```cobol
           IF WS-XFER-AMT > WS-DAILY-LIMIT
              OR WS-WATCHLIST-HIT = "Y"
               PERFORM 8000-REJECT-TRANSFER
           END-IF
```

## How to fix

Keep code within columns 8-72, use columns 73-80 only for sequence numbers or change tags, and split long statements across lines.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-014 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-561: Dead Code](https://cwe.mitre.org/data/definitions/561.html)
- [IBM Enterprise COBOL for z/OS Language Reference](https://www.ibm.com/docs/en/cobol-zos)
- [GnuCOBOL reference format (fixed, free, variable)](https://gnucobol.sourceforge.io/doc/gnucobol.html)
