! SPDX-License-Identifier: Apache-2.0
!> Byte helpers for the Rampart Fortran kernel.
!>
!> Fortran has no unsigned integers. Bytes travel as int8 (the bit pattern of a
!> C uint8_t) and are widened to int64 values in [0, 255] before any
!> arithmetic, so no computation depends on how the processor represents
!> negative integers.
module rampart_bytes
  use, intrinsic :: iso_fortran_env, only: int8, int64
  implicit none
  private

  public :: ub, to_byte, bytes_of, hex_encode, hex_decode

contains

  !> Unsigned value (0..255) of a byte.
  elemental function ub(b) result(v)
    integer(int8), intent(in) :: b
    integer(int64) :: v

    v = int(b, int64)
    if (v < 0_int64) v = v + 256_int64
  end function ub

  !> Byte holding the low 8 bits of v.
  elemental function to_byte(v) result(b)
    integer(int64), intent(in) :: v
    integer(int8) :: b
    integer(int64) :: low

    low = modulo(v, 256_int64)
    if (low > 127_int64) low = low - 256_int64
    b = int(low, int8)
  end function to_byte

  !> ASCII bytes of a character string.
  pure function bytes_of(s) result(bytes)
    character(len=*), intent(in) :: s
    integer(int8) :: bytes(len(s))
    integer :: i

    do i = 1, len(s)
      bytes(i) = to_byte(int(iachar(s(i:i)), int64))
    end do
  end function bytes_of

  !> Lower-case hexadecimal encoding; hex must hold 2*size(bytes) characters.
  pure subroutine hex_encode(bytes, hex)
    integer(int8), intent(in) :: bytes(:)
    character(len=*), intent(out) :: hex
    character(len=16), parameter :: DIGITS = '0123456789abcdef'
    integer :: i, hi, lo

    hex = ''
    do i = 1, min(size(bytes), len(hex) / 2)
      hi = int(ub(bytes(i)) / 16_int64) + 1
      lo = int(modulo(ub(bytes(i)), 16_int64)) + 1
      hex(2*i - 1:2*i - 1) = DIGITS(hi:hi)
      hex(2*i:2*i) = DIGITS(lo:lo)
    end do
  end subroutine hex_encode

  !> Decode hexadecimal text (either case). On odd length, a bad digit or a
  !> too-small output buffer, ok is .false. and bytes is all zeros.
  pure subroutine hex_decode(hex, bytes, nbytes, ok)
    character(len=*), intent(in) :: hex
    integer(int8), intent(out) :: bytes(:)
    integer, intent(out) :: nbytes
    logical, intent(out) :: ok
    integer :: i, hi, lo

    bytes = 0_int8
    nbytes = 0
    ok = .false.
    if (modulo(len(hex), 2) /= 0) return
    if (len(hex) / 2 > size(bytes)) return

    do i = 1, len(hex) / 2
      hi = nibble(hex(2*i - 1:2*i - 1))
      lo = nibble(hex(2*i:2*i))
      if (hi < 0 .or. lo < 0) then
        bytes = 0_int8
        return
      end if
      bytes(i) = to_byte(int(hi * 16 + lo, int64))
    end do
    nbytes = len(hex) / 2
    ok = .true.
  end subroutine hex_decode

  pure function nibble(c) result(v)
    character(len=1), intent(in) :: c
    integer :: v

    select case (c)
    case ('0':'9')
      v = iachar(c) - iachar('0')
    case ('a':'f')
      v = iachar(c) - iachar('a') + 10
    case ('A':'F')
      v = iachar(c) - iachar('A') + 10
    case default
      v = -1
    end select
  end function nibble

end module rampart_bytes
