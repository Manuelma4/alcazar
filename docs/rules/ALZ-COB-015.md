# ALZ-COB-015: ALTER statement (self-modifying control flow)

| | |
|---|---|
| **Severity** | Low |
| **CWE** | [CWE-691: Insufficient Control Flow Management](https://cwe.mitre.org/data/definitions/691.html) |
| **Language** | COBOL |
| **Precision** | High |
| **SARIF name** | `AlterStatement` |

ALTER changes the target of a GO TO at run time.

## What Watchtower detects

Every `ALTER` statement in the PROCEDURE DIVISION.

## Why it matters in legacy systems

ALTER rewrites the target of a `GO TO` at run time, so the jump written in the source is not the jump that executes once ALTER has run. Old programs used it for "first time" switches; in reviews and incident analysis it makes the actual path depend on history that is invisible in the listing. It was declared obsolete in COBOL-85 and removed in COBOL 2002.

## Vulnerable example

```cobol
           IF IN-ROUTE-CODE = "PRIORITY"
               ALTER 3000-ROUTE TO PROCEED TO 3200-PRIORITY-ROUTE
           END-IF
           PERFORM 3000-ROUTE THRU 3999-ROUTE-EXIT
```

## Fixed example

```cobol
           EVALUATE IN-ROUTE-CODE
               WHEN "PRIORITY"
                   PERFORM 3200-PRIORITY-ROUTE
               WHEN OTHER
                   PERFORM 3100-STANDARD-ROUTE
           END-EVALUATE
```

## How to fix

Replace ALTER with explicit state: set a flag or condition-name and choose the path with EVALUATE or PERFORM.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-015 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-691: Insufficient Control Flow Management](https://cwe.mitre.org/data/definitions/691.html)
- [IBM Enterprise COBOL for z/OS Language Reference](https://www.ibm.com/docs/en/cobol-zos)
