# ALZ-GEN-003: Secret material in source

| | |
|---|---|
| **Severity** | High |
| **CWE** | [CWE-798: Use of Hard-coded Credentials](https://cwe.mitre.org/data/definitions/798.html) |
| **Language** | Any (COBOL, Fortran and other text) |
| **Precision** | High |
| **SARIF name** | `SecretInSource` |

A private key or a cloud or API token pattern appears in the file.

## What Watchtower detects

PEM private keys (`-----BEGIN ... PRIVATE KEY-----`), AWS access key ids (`AKIA` followed by 16 upper-case letters or digits), GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_` followed by at least 36 characters) and Slack tokens (`xoxa-`, `xoxb-`, `xoxp-`, `xoxr-`, `xoxs-` followed by at least 10 characters), anywhere in the file. The snippet stored with the finding is redacted.

## Why it matters in legacy systems

Old batch programs are being moved to Git hosting and CI pipelines, and keys pasted into comments or literals years ago move with them. Public and internal repositories are scanned by attackers within minutes of a push; a cloud key in a Fortran comment is as exploitable as one in a web application.

## Vulnerable example

```fortran
  ! Upload credentials for the risk feed
  character(len=*), parameter :: feed_key_id = 'AKIA...EXAMPLE'
```

## Fixed example

```fortran
  ! The feed key is provided by the scheduler at run time.
  call get_environment_variable('RISK_FEED_KEY_ID', key_id, key_len, env_status)
```

## How to fix

Revoke and rotate the credential now, purge it from history, and load it from a secrets manager at run time.

## Notes and limitations

Treat a detected secret as compromised: revoke and rotate it first, then remove it from the history. The sample key in the vulnerable examples is AWS's public documentation example.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```cobol
      *> watchtower-ignore ALZ-GEN-003 -- <why this occurrence is safe>
```

```fortran
! watchtower-ignore ALZ-GEN-003 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-798: Use of Hard-coded Credentials](https://cwe.mitre.org/data/definitions/798.html)
- [OWASP: Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [AWS: managing access keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html)
- [GitHub token formats](https://github.blog/2021-04-05-behind-githubs-new-authentication-token-formats/)
