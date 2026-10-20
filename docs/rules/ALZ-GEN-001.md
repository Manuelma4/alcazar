# ALZ-GEN-001: Bidirectional control character (Trojan Source)

| | |
|---|---|
| **Severity** | Critical |
| **CWE** | [CWE-451: User Interface (UI) Misrepresentation of Critical Information](https://cwe.mitre.org/data/definitions/451.html) |
| **Language** | Any (COBOL, Fortran and other text) |
| **Precision** | High |
| **SARIF name** | `BidiControlCharacter` |

The file contains Unicode bidirectional override or isolate characters.

## What Watchtower detects

Any Unicode bidirectional control character, U+202A to U+202E (embeddings and overrides) and U+2066 to U+2069 (isolates), anywhere in the file: code, comments or literals, in any language. One finding per line, listing the characters found.

## Why it matters in legacy systems

Trojan Source (CVE-2021-42574) showed that these invisible characters reorder how a line is displayed without changing what the compiler reads: a comment can appear to end early, a string can appear to contain code, and an early return can look commented out. Legacy code bases are now reviewed in web-based diff tools that render bidi text, and COBOL and Fortran compilers happily accept the characters inside comments and literals.

## Vulnerable example

```cobol
      *    Only administrators approve.<U+202E><U+2066> batch users too<U+2069><U+202C>
           IF WS-ROLE = "ADMIN<U+202E><U+2066> *> or any user <U+2069><U+2066>"
```

## Fixed example

```cobol
      *    Only administrators approve.
           IF WS-ROLE = "ADMIN"
```

## How to fix

Remove the characters. Right-to-left text belongs in external resources, not in source; make editors and CI reject bidi controls.

## Notes and limitations

The vulnerable example is written with `<U+202E>` placeholders; `examples/vulnerable/trojan_source.cob` contains the real characters. The text report replaces control characters with U+FFFD so the report itself cannot be reordered.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-GEN-001 -- <why this occurrence is safe>
```

```fortran
! watchtower-ignore ALZ-GEN-001 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-451: User Interface (UI) Misrepresentation of Critical Information](https://cwe.mitre.org/data/definitions/451.html)
- [Trojan Source: Invisible Vulnerabilities (Boucher and Anderson)](https://trojansource.codes/)
- [CVE-2021-42574](https://nvd.nist.gov/vuln/detail/CVE-2021-42574)
- [Unicode Bidirectional Algorithm (UAX #9)](https://www.unicode.org/reports/tr9/)
