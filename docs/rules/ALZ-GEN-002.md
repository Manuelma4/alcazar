# ALZ-GEN-002: Invisible character or non-ASCII identifier (homoglyph)

| | |
|---|---|
| **Severity** | High |
| **CWE** | [CWE-1007: Insufficient Visual Distinction of Homoglyphs Presented to User](https://cwe.mitre.org/data/definitions/1007.html) |
| **Language** | Any (COBOL, Fortran and other text) |
| **Precision** | High |
| **SARIF name** | `InvisibleCharacterOrHomoglyph` |

Zero-width characters, or non-ASCII letters inside identifiers, can make different names look identical.

## What Watchtower detects

Invisible characters — every Default_Ignorable_Code_Point that is not a bidi control: zero-width characters (U+200B to U+200D, U+2060 to U+2064), the soft hyphen U+00AD, the Hangul fillers, U+180E, variation selectors, tag characters, and U+FEFF anywhere but at offset 0, where it is a byte-order mark — on any line, and COBOL or Fortran identifiers that contain non-ASCII letters, such as a Cyrillic A (U+0410) in `WS-BALANCE`. Non-ASCII text in comments and literals is fine.

## Why it matters in legacy systems

A second variable whose name differs only by a homoglyph, or by an invisible character, looks identical in review: the limit check can compare against `WS-LIMIT` written with a Cyrillic I, holding 9,999,999.99 instead of 500.00. Searches and diffs fail to match the real name, which hides the change.

## Vulnerable example

```cobol
       01  WS-LIMIT                PIC 9(7)V99 VALUE 500.00.
       01  WS-L<U+0406>MIT                PIC 9(7)V99 VALUE 9999999.99.
           IF WS-XFER-AMT <= WS-L<U+0406>MIT
               MOVE "Y" TO WS-APP<U+200B>ROVED
           END-IF
```

## Fixed example

```cobol
       01  WS-LIMIT                PIC 9(7)V99 VALUE 500.00.
           IF WS-XFER-AMT <= WS-LIMIT
               MOVE "Y" TO WS-APPROVED
           END-IF
```

## How to fix

Use plain ASCII identifiers, delete zero-width characters, and enforce an ASCII-only check in CI.

## Notes and limitations

Placeholders such as `<U+0406>` stand for the real characters, which are present only in `examples/vulnerable/trojan_source.cob`.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-GEN-002 -- <why this occurrence is safe>
```

```fortran
! watchtower-ignore ALZ-GEN-002 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-1007: Insufficient Visual Distinction of Homoglyphs Presented to User](https://cwe.mitre.org/data/definitions/1007.html)
- [Unicode Technical Report #36: Security Considerations](https://www.unicode.org/reports/tr36/)
- [Unicode Technical Standard #39: Security Mechanisms](https://www.unicode.org/reports/tr39/)
