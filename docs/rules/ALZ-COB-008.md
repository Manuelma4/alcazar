# ALZ-COB-008: Alphanumeric truncation in MOVE

| | |
|---|---|
| **Severity** | Low |
| **CWE** | [CWE-222: Truncation of Security-relevant Information](https://cwe.mitre.org/data/definitions/222.html) |
| **Language** | COBOL |
| **Precision** | High |
| **SARIF name** | `AlphanumericTruncation` |

An alphanumeric value is moved into a shorter field and is cut off.

## What Watchtower detects

`MOVE` between alphanumeric or alphabetic elementary items where the sender is longer than the receiver, and `MOVE` of a string literal longer than the receiver. Group items and reference-modified operands are ignored (an explicit `WS-SRC(1:20)` documents the intent).

## Why it matters in legacy systems

Truncation creates collisions and bypasses: two beneficiary names that differ after character 20 become identical in a sanctions-screening key, an account id loses its check digits, or a validated value is shortened into something different. The compiler gives no warning by default.

## Vulnerable example

```cobol
       01  IN-BENEF-NAME               PIC X(40).
       01  WS-BENEF-SHORT              PIC X(20).
      *    ...
           MOVE IN-BENEF-NAME TO WS-BENEF-SHORT
```

## Fixed example

```cobol
       01  IN-BENEF-NAME               PIC X(40).
       01  WS-BENEF-NAME               PIC X(40).
      *    ...
           MOVE IN-BENEF-NAME TO WS-BENEF-NAME
```

## How to fix

Make the receiver at least as long as the sender, or move an explicit reference-modified substring (WS-SRC(1:20)) after validating the length.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-008 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-222: Truncation of Security-relevant Information](https://cwe.mitre.org/data/definitions/222.html)
- [IBM Enterprise COBOL for z/OS Language Reference](https://www.ibm.com/docs/en/cobol-zos)
