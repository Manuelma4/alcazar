# ALZ-FOR-008: Non-constant-time comparison of a secret

| | |
|---|---|
| **Severity** | High |
| **CWE** | [CWE-208: Observable Timing Discrepancy](https://cwe.mitre.org/data/definitions/208.html) |
| **Language** | Fortran |
| **Precision** | Medium |
| **SARIF name** | `NonConstantTimeSecretCompare` |

A password, token, MAC, digest or signature is compared with == / .eq. / /= / .ne.

## What Watchtower detects

`==`, `.eq.`, `/=` or `.ne.` with an operand that names a secret: password, passwd, secret, token, hmac, mac, signature, digest, apikey / api_key, otp (as words, so `machine` is not a MAC). Lengths and inquiries (`len(token)`, `size(...)`), comparisons with blank strings or numbers, and known-answer tests that compare a computed MAC with a constant literal (`hmac_hex(k, m) == 'b0344c...'`) are not reported.

## Why it matters in legacy systems

Character comparison stops at the first differing byte, so the response time of an authorisation check reveals how many leading characters of a guessed token were right, and remote timing attacks recover MACs byte by byte. Fortran also pads the shorter operand with blanks, so "admin" == "admin   " is .true.: trailing-blank variants of a secret are accepted.

## Vulnerable example

```fortran
    ok = presented_token == expected_token .and. presented_key == api_key
```

## Fixed example

```fortran
  pure logical function ct_equal(a, b) result(same)
    character(len=*), intent(in) :: a, b
    integer :: k, diff
    diff = ieor(len(a), len(b))
    do k = 1, min(len(a), len(b))
      diff = ior(diff, ieor(ichar(a(k:k)), ichar(b(k:k))))
    end do
    same = diff == 0
  end function ct_equal
```

## How to fix

Compare secrets with a constant-time routine that checks the lengths first and XOR-accumulates every byte (ieor on ichar), and compare fixed-length digests rather than raw passwords.

## Suppressing a finding

If an occurrence is safe, document why in a comment on the same line or on the line just above:

```fortran
! watchtower-ignore ALZ-FOR-008 -- <why this occurrence is safe>
```

A suppression without a `-- reason` is ignored and the finding stays. Suppressed findings are kept in the JSON
output and appear in SARIF with `suppressions: [{ kind: "inSource", justification }]`.

## References

- [CWE-208: Observable Timing Discrepancy](https://cwe.mitre.org/data/definitions/208.html)
- [CWE-208 discussion of timing side channels](https://cwe.mitre.org/data/definitions/208.html)
- [Fortran character comparison blank padding (gfortran intrinsic LGE/LLT notes)](https://gcc.gnu.org/onlinedocs/gfortran/LGE.html)
