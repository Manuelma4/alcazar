! SPDX-License-Identifier: Apache-2.0
!> alzhmac — SHA-256 / HMAC-SHA256 of hex-encoded inputs, one case per line:
!>
!>   S <message-hex>            ->  SHA-256(message)
!>   H <key-hex> <message-hex>  ->  HMAC-SHA256(key, message)
!>
!> One lower-case hex digest per output line. Used by the differential tests
!> that compare the Fortran kernel with OpenSSL on thousands of random inputs
!> (rampart/fortran/test/differential.test.mjs).
program alzhmac
  use, intrinsic :: iso_fortran_env, only: int8, input_unit, output_unit, error_unit, iostat_eor
  use rampart_bytes, only: hex_decode, hex_encode
  use rampart_hmac, only: hmac_sha256
  use rampart_sha256, only: sha256, SHA256_LEN
  implicit none

  integer, parameter :: MAX_LINE = 4 * 1024 * 1024
  character(len=:), allocatable :: line
  character(len=2 * SHA256_LEN) :: hex
  integer(int8), allocatable :: key(:), msg(:)
  integer(int8) :: digest(SHA256_LEN)
  integer :: lineno, space
  logical :: ok

  lineno = 0
  do
    call read_line(input_unit, line, ok)
    if (.not. ok) exit
    lineno = lineno + 1
    if (len(line) < 2) call fail(lineno)
    select case (line(1:2))
    case ('S ')
      call decode(line(3:), msg, ok)
      if (.not. ok) call fail(lineno)
      call sha256(msg, digest)
    case ('H ')
      space = index(line(3:), ' ')
      if (space == 0) call fail(lineno)
      call decode(line(3:space + 1), key, ok)
      if (.not. ok) call fail(lineno)
      call decode(line(space + 3:), msg, ok)
      if (.not. ok) call fail(lineno)
      call hmac_sha256(key, msg, digest)
    case default
      call fail(lineno)
    end select
    call hex_encode(digest, hex)
    write (output_unit, '(a)') hex
  end do

contains

  !> One whole input line of any length up to MAX_LINE.
  subroutine read_line(unit, line, ok)
    integer, intent(in) :: unit
    character(len=:), allocatable, intent(out) :: line
    logical, intent(out) :: ok
    character(len=4096) :: chunk
    integer :: ios, n

    line = ''
    ok = .false.
    do
      read (unit, '(a)', advance='no', size=n, iostat=ios) chunk
      if (ios /= 0 .and. ios /= iostat_eor) return
      line = line // chunk(1:n)
      if (len(line) > MAX_LINE) return
      if (ios == iostat_eor) exit
    end do
    ok = .true.
  end subroutine read_line

  subroutine decode(text, bytes, ok)
    character(len=*), intent(in) :: text
    integer(int8), allocatable, intent(out) :: bytes(:)
    logical, intent(out) :: ok
    integer :: n

    allocate(bytes(len(text) / 2))
    call hex_decode(text, bytes, n, ok)
  end subroutine decode

  subroutine fail(lineno)
    integer, intent(in) :: lineno

    write (error_unit, '(a,i0)') 'alzhmac: malformed input at line ', lineno
    stop 2, quiet=.true.
  end subroutine fail

end program alzhmac
