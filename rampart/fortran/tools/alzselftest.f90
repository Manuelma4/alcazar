! SPDX-License-Identifier: Apache-2.0
!> alzselftest — run the kernel's known-answer tests and report them as JSON.
!> Gatehouse runs it at start-up; exit status 0 only when every check passes.
program alzselftest
  use rampart_kat, only: kat_sha256, kat_hmac, kat_ct, kat_hex
  implicit none
  logical :: sha, mac, ct, hex

  sha = kat_sha256()
  mac = kat_hmac()
  ct = kat_ct()
  hex = kat_hex()
  write (*, '(a)') '{"checks":[' // check('sha256-fips180-4', sha) // ',' // &
    check('hmac-sha256-rfc4231', mac) // ',' // check('constant-time-compare', ct) // ',' // &
    check('hex-codec', hex) // ']}'
  if (.not. (sha .and. mac .and. ct .and. hex)) stop 1, quiet=.true.

contains

  function check(name, passed) result(out)
    character(len=*), intent(in) :: name
    logical, intent(in) :: passed
    character(len=:), allocatable :: out

    if (passed) then
      out = '{"name":"' // name // '","status":"pass"}'
    else
      out = '{"name":"' // name // '","status":"fail"}'
    end if
  end function check

end program alzselftest
