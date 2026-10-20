# ALZ-COB-004: Hard-coded credential in a VALUE clause

| | |
|---|---|
| **Severity** | High |
| **CWE** | [CWE-798: Use of Hard-coded Credentials](https://cwe.mitre.org/data/definitions/798.html) |
| **Language** | COBOL |
| **Precision** | Medium |
| **SARIF name** | `HardcodedCredential` |

A password, PIN, token or key field is initialised with a literal.

## What Watchtower detects

A data item whose name contains PASSWORD, PASSWD, PWD, SECRET, TOKEN, API-KEY, APIKEY, CREDENTIAL, PRIVATE-KEY or PASSPHRASE, or that ends in PIN, initialised with a non-blank literal (`VALUE "..."`, or a non-zero numeric literal for PIN/password items). Figurative constants (SPACES, LOW-VALUES, ZEROS...) and `""` are ignored, and so are names that describe metadata (`-LEN`, `-PROMPT`, `-ENV`, `-TRIES`, `-MASK`...). The secret itself is never repeated in the message.

## Why it matters in legacy systems

Database and FTP passwords in WORKING-STORAGE are a classic mainframe finding: the literal is in the source PDS, in every compile listing kept by SCLM/Endevor, in the load module (visible with a simple browse), and in every backup. Rotating it requires a recompile and a change ticket, so it is rarely rotated.

## Vulnerable example

```cobol
       01  WS-DB-USER                  PIC X(8)  VALUE "XFERBAT".
       01  WS-DB-PASSWORD              PIC X(16) VALUE "Tr3asury#2019".
```

## Fixed example

```cobol
       01  WS-DB-PASSWORD              PIC X(64).
      *    ...
           ACCEPT WS-DB-PASSWORD FROM ENVIRONMENT "ACCTXFER_DB_PASSWORD"
           CALL "DBCONNECT" USING WS-DB-USER WS-DB-PASSWORD
           MOVE LOW-VALUES TO WS-DB-PASSWORD
```

## How to fix

Remove the literal and obtain the secret at run time (ACCEPT ... FROM ENVIRONMENT, a protected dataset, or a credential service); clear the field after use.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-004 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-798: Use of Hard-coded Credentials](https://cwe.mitre.org/data/definitions/798.html)
- [OWASP: Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
