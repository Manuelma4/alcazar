# ALZ-FOR-009: Hard-coded credential

| | |
|---|---|
| **Severity** | High |
| **CWE** | [CWE-798: Use of Hard-coded Credentials](https://cwe.mitre.org/data/definitions/798.html) |
| **Language** | Fortran |
| **Precision** | Medium |
| **SARIF name** | `HardcodedCredential` |

A character variable or parameter named like a password, token or key is initialised with a literal.

## What Watchtower detects

A `character` variable or parameter whose name matches password, passwd, secret, token, api_key / apikey, credential or passphrase, initialised with a non-blank literal: in a type declaration, a `PARAMETER (...)` statement or a `DATA` statement. Metadata names (`_len`, `_prompt`, `_env`, `_name`...) are not reported.

## Why it matters in legacy systems

Keys compiled into Fortran executables end up in every build artifact and container image; `strings risk_engine` prints them. Shared credentials in source cannot be rotated without a rebuild and are copied to every developer clone.

## Vulnerable example

```fortran
  character(len=*), parameter :: api_key = 'AKIA...EXAMPLE'
```

## Fixed example

```fortran
    character(len=128) :: api_key
    integer :: key_len, env_status
    call get_environment_variable('RISK_API_KEY', api_key, key_len, env_status)
    if (env_status /= 0 .or. key_len < 1 .or. key_len > len(api_key)) return
```

## How to fix

Load secrets at run time (get_environment_variable, a protected file read with iostat, or a secrets manager) and never commit them.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-009 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-798: Use of Hard-coded Credentials](https://cwe.mitre.org/data/definitions/798.html)
- [OWASP: Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [gfortran GET_ENVIRONMENT_VARIABLE](https://gcc.gnu.org/onlinedocs/gfortran/GET_005fENVIRONMENT_005fVARIABLE.html)
