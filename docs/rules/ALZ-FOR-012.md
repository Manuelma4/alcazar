# ALZ-FOR-012: Non-cryptographic PRNG used for secrets

| | |
|---|---|
| **Severity** | High |
| **CWE** | [CWE-338: Use of Cryptographically Weak Pseudo-Random Number Generator (PRNG)](https://cwe.mitre.org/data/definitions/338.html) |
| **Language** | Fortran |
| **Precision** | Low |
| **SARIF name** | `WeakRandomForSecrets` |

random_number, rand or ran is used in a procedure that handles keys, tokens, nonces, salts or sessions.

## What Watchtower detects

`random_number`, and `rand(...)` / `ran(...)` calls that are not local variables, in a procedure (or its procedure hosts) that also mentions key, token, nonce, salt, password, secret, otp, session or iv in identifiers or string literals. Modules and main programs are not used as context, so a simulation routine next to unrelated key handling is not reported.

## Why it matters in legacy systems

The intrinsic generators are fast statistical PRNGs (xoshiro256** in gfortran): a few outputs reveal the state, and seeds are often fixed or derived from the clock. Session tokens, nonces or salts derived from them can be predicted, so an attacker can forge sessions or replay one-time codes.

## Vulnerable example

```fortran
  subroutine new_session_token(token)
    character(len=32), intent(out) :: token
    real :: r
    integer :: k
    do k = 1, len(token)
      call random_number(r)
      token(k:k) = achar(65 + int(r * 26))
    end do
  end subroutine new_session_token
```

## Fixed example

```fortran
    open (newunit=u, file='/dev/urandom', access='stream', form='unformatted', &
          action='read', iostat=ios)
    if (ios /= 0) return
    read (u, iostat=ios) bytes
    close (u, iostat=closed)
```

## How to fix

Read random bytes from the operating-system CSPRNG (/dev/urandom, getrandom(2) or BCryptGenRandom through BIND(C)) for every security-sensitive value.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-012 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-338: Use of Cryptographically Weak Pseudo-Random Number Generator (PRNG)](https://cwe.mitre.org/data/definitions/338.html)
- [OWASP: Cryptographic Storage Cheat Sheet (secure random)](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [gfortran RANDOM_NUMBER](https://gcc.gnu.org/onlinedocs/gfortran/RANDOM_005fNUMBER.html)
