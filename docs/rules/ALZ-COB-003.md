# ALZ-COB-003: Dynamic SQL built from a host variable

| | |
|---|---|
| **Severity** | High |
| **CWE** | [CWE-89: Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')](https://cwe.mitre.org/data/definitions/89.html) |
| **Language** | COBOL |
| **Precision** | High |
| **SARIF name** | `DynamicSql` |

EXEC SQL PREPARE ... FROM :var or EXECUTE IMMEDIATE :var runs SQL text taken from a host variable.

## What Watchtower detects

Inside `EXEC SQL ... END-EXEC`: `PREPARE name FROM :host-variable` and `EXECUTE IMMEDIATE :host-variable`. Static SQL with host variables and `EXECUTE IMMEDIATE` with a literal statement are not reported.

## Why it matters in legacy systems

Dynamic SQL arrived in many COBOL/DB2 shops to support "flexible" customer search screens. The statement text is usually assembled with `STRING` from terminal or file input, so a customer id like `X' OR '1'='1` returns every row and `'; DELETE FROM ...` destroys data, all under the DB2 plan's authorisations, which are typically broad for batch.

## Vulnerable example

```cobol
           STRING "SELECT CUST_NAME FROM BANK.CUSTOMER WHERE CUST_ID = '"
                  DELIMITED BY SIZE
                  WS-CUST-ID DELIMITED BY SPACE
                  "'" DELIMITED BY SIZE
                  INTO WS-SQL-TEXT
           END-STRING
           EXEC SQL PREPARE CUSTSTMT FROM :WS-SQL-TEXT END-EXEC
```

## Fixed example

```cobol
           EXEC SQL
               SELECT CUST_NAME
                 INTO :WS-CUST-NAME
                 FROM BANK.CUSTOMER
                WHERE CUST_ID = :WS-CUST-ID
           END-EXEC
```

## How to fix

Use static SQL with host variables (WHERE CUST_ID = :WS-CUST-ID), or PREPARE a constant statement with parameter markers (?) and supply values with EXECUTE ... USING.

## Notes and limitations

The rule cannot see how the host variable was filled; a `PREPARE` of a constant held in a variable is still reported. Prefer a literal statement with parameter markers (`?`) and `EXECUTE ... USING`, or suppress with a justification.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-003 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-89: Improper Neutralization of Special Elements used in an SQL Command ('SQL Injection')](https://cwe.mitre.org/data/definitions/89.html)
- [OWASP: SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- [IBM Db2 for z/OS: dynamic SQL](https://www.ibm.com/docs/en/db2-for-zos)
