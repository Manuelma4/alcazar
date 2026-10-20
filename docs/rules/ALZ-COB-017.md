# ALZ-COB-017: Secret read with ACCEPT

| | |
|---|---|
| **Severity** | Low |
| **CWE** | [CWE-316: Cleartext Storage of Sensitive Information in Memory](https://cwe.mitre.org/data/definitions/316.html) |
| **Language** | COBOL |
| **Precision** | Medium |
| **SARIF name** | `SecretAccept` |

ACCEPT reads a password, PIN, token or cryptographic key from standard input.

## What Watchtower detects

An `ACCEPT` whose receiving field is named like a credential (PASSWORD, PASSWD, PWD, PIN, SECRET, TOKEN, API-KEY, PRIVATE-KEY, CREDENTIAL) or a cryptographic key — a KEY that also says MASTER, SECRET, PRIVATE, HMAC, MAC, AES, DES, CRYPTO, CIPHER, SIGNING, SESSION, ENC, HEX, LEDGER or SUB, or a compound such as HMACKEY or AESKEY. A plain record key (`WS-CUST-KEY`) is not a secret. `ACCEPT ... FROM DATE / TIME / COMMAND-LINE / ENVIRONMENT ...` does not read standard input and is not reported.

## Why it matters in legacy systems

Batch programs moved off the mainframe often receive their keys the way a job used to get its parameters: on SYSIN, now standard input, read with `ACCEPT`. On GnuCOBOL, `ACCEPT` reads through the C library's stdin buffer and then through the run time's own line buffer before the field is filled. Wiping the field afterwards is not enough: Alcazar measured three copies of the hex text of two keys left on the heap after `TXNGUARD` had zeroized its field ([hardening note 20](../HARDENING.md)). A core dump, a swap file, a debugger or a memory-scraping attacker finds them there.

## Vulnerable example

```cobol
           ACCEPT WS-HMAC-KEY
           DISPLAY "KEY LOADED: " WS-HMAC-KEY
```

## Fixed example

```cobol
      *    read(2) straight into the field: the field is the only copy.
           CALL "alz_read_line" USING WS-HMAC-KEY WS-KEY-CAP WS-KEY-LEN
                            RETURNING WS-RC
           IF WS-RC = 0
               CALL "alz_expect_eof" RETURNING WS-RC
           END-IF
      *    ... use the key ...
           CALL "alz_zeroize" USING WS-HMAC-KEY WS-KEY-CAP
                          RETURNING WS-WIPE-RC
```

The whole program is in [`examples/hardened/KEYLOAD.cbl`](../../examples/hardened/KEYLOAD.cbl).

## How to fix

Read secrets with an unbuffered read straight into the field (read(2), byte by byte, as Rampart's alz_read_line does), zeroize the field after use, and refuse input beyond what the program needs (alz_expect_eof). Better still, receive only derived, purpose-specific keys.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-COB-017 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-316: Cleartext Storage of Sensitive Information in Memory](https://cwe.mitre.org/data/definitions/316.html)
- [CWE-226: Sensitive Information in Resource Not Removed Before Reuse](https://cwe.mitre.org/data/definitions/226.html)
- [OWASP: Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
