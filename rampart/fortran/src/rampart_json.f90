! SPDX-License-Identifier: Apache-2.0
!> Minimal JSON value formatting that is safe by construction.
!>
!> * Every string is escaped; control and non-ASCII bytes become \u00XX, so
!>   no input can break out of a string or the document.
!> * Every number is valid JSON: gfortran's F0.d edit descriptor writes 0.5 as
!>   ".500000", which JSON parsers reject, so the leading zero is restored.
!> * NaN and infinities, which JSON cannot represent, become null.
module rampart_json
  use, intrinsic :: iso_fortran_env, only: int64, real64
  use, intrinsic :: ieee_arithmetic, only: ieee_is_finite
  implicit none
  private

  public :: json_string, json_int, json_real

contains

  pure function json_string(s) result(out)
    character(len=*), intent(in) :: s
    character(len=:), allocatable :: out
    character(len=6) :: escaped
    integer :: i, code

    out = '"'
    do i = 1, len(s)
      code = modulo(iachar(s(i:i)), 256)
      select case (code)
      case (34)
        out = out // '\"'
      case (92)
        out = out // '\\'
      case (32:33, 35:91, 93:126)
        out = out // s(i:i)
      case default
        write (escaped, '(a,z4.4)') '\u', code
        out = out // escaped
      end select
    end do
    out = out // '"'
  end function json_string

  pure function json_int(v) result(out)
    integer(int64), intent(in) :: v
    character(len=:), allocatable :: out
    character(len=24) :: buf

    write (buf, '(i0)') v
    out = trim(buf)
  end function json_int

  !> Up to 6 decimals in fixed notation; scientific notation outside
  !> [1e-4, 1e15) so small p-values keep their precision.
  pure function json_real(x) result(out)
    real(real64), intent(in) :: x
    character(len=:), allocatable :: out
    character(len=40) :: buf

    if (.not. ieee_is_finite(x)) then
      out = 'null'
    else if (abs(x) < tiny(x)) then
      out = '0'
    else if (abs(x) < 1.0e-4_real64 .or. abs(x) >= 1.0e15_real64) then
      ! 17 significant digits: every double round-trips (15 could round
      ! huge(x) up to a number JSON.parse reads as Infinity).
      write (buf, '(es25.16e3)') x
      out = trim(adjustl(buf))
    else
      write (buf, '(f0.6)') x
      out = trim(adjustl(buf))
      if (out(1:1) == '.') then
        out = '0' // out
      else if (out(1:2) == '-.') then
        out = '-0' // out(2:)
      end if
    end if
  end function json_real

end module rampart_json
