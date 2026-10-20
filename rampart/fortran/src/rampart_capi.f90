! SPDX-License-Identifier: Apache-2.0
!> C ABI of the Rampart Fortran kernel — see rampart/fortran/include/alz.h.
!>
!> Every argument is passed by reference, so COBOL (CALL "alz_..." USING BY
!> REFERENCE ... RETURNING rc) and C call the same entry points. Every entry
!> point returns an int32 status (ALZ_OK or a negative ALZ_E_* code): a void
!> function would leave garbage in COBOL's RETURN-CODE. Lengths are validated
!> before any buffer is touched.
module rampart_capi
  use, intrinsic :: iso_c_binding, only: c_char, c_int, c_int8_t, c_int32_t, c_loc, c_ptr, c_ptrdiff_t, c_size_t
  use rampart_bytes, only: hex_encode, hex_decode
  use rampart_sha256, only: sha256, SHA256_LEN
  use rampart_hmac, only: hmac_sha256
  use rampart_ct, only: ct_equal, zeroize
  use rampart_kat, only: kat_all
  implicit none
  private

  integer(c_int32_t), parameter, public :: ALZ_OK = 0
  integer(c_int32_t), parameter, public :: ALZ_DIFFERENT = 1
  integer(c_int32_t), parameter, public :: ALZ_E_LENGTH = -1
  integer(c_int32_t), parameter, public :: ALZ_E_HEX = -2
  integer(c_int32_t), parameter, public :: ALZ_E_CAPACITY = -3
  integer(c_int32_t), parameter, public :: ALZ_E_EOF = -4
  integer(c_int32_t), parameter, public :: ALZ_E_IO = -5
  integer(c_int32_t), parameter, public :: ALZ_E_TRUNCATED = -6
  integer(c_int32_t), parameter, public :: ALZ_E_SELFTEST = -10

  !> Upper bound for any single buffer (16 MiB): bounds the work an untrusted
  !> length can cause.
  integer(c_int32_t), parameter, public :: ALZ_MAX_LEN = 16777216

  public :: capi_sha256, capi_sha256_hex, capi_hmac_sha256, capi_hmac_sha256_hex
  public :: capi_ct_equal, capi_hex_decode, capi_hex_encode, capi_zeroize, capi_selftest
  public :: capi_read_line, capi_expect_eof, capi_discard_input

  !> Standard input, read with read(2) in chunks into this buffer: no stdio
  !> or run-time copy, and every line is wiped from it once handed over.
  integer, parameter :: IN_CHUNK = 4096
  integer(c_int8_t), target :: in_buf(IN_CHUNK) = 0_c_int8_t
  integer :: in_pos = 1, in_len = 0

  interface
    !> POSIX read(2). ssize_t has the width of ptrdiff_t on every POSIX ABI.
    function posix_read(fd, buf, count) result(got) bind(C, name='read')
      import :: c_int, c_ptr, c_ptrdiff_t, c_size_t
      integer(c_int), value :: fd
      type(c_ptr), value :: buf
      integer(c_size_t), value :: count
      integer(c_ptrdiff_t) :: got
    end function posix_read
  end interface

contains

  pure logical function valid_length(n)
    integer(c_int32_t), intent(in) :: n

    valid_length = n >= 0 .and. n <= ALZ_MAX_LEN
  end function valid_length

  !> int32_t alz_sha256(const uint8_t *msg, const int32_t *len, uint8_t digest[32])
  function capi_sha256(msg, msglen, digest) result(rc) bind(C, name='alz_sha256')
    integer(c_int8_t), intent(in) :: msg(*)
    integer(c_int32_t), intent(in) :: msglen
    integer(c_int8_t), intent(out) :: digest(SHA256_LEN)
    integer(c_int32_t) :: rc

    digest = 0_c_int8_t
    rc = ALZ_E_LENGTH
    if (.not. valid_length(msglen)) return
    call sha256(msg(1:msglen), digest)
    rc = ALZ_OK
  end function capi_sha256

  !> int32_t alz_sha256_hex(const uint8_t *msg, const int32_t *len, char hex[64])
  function capi_sha256_hex(msg, msglen, hex) result(rc) bind(C, name='alz_sha256_hex')
    integer(c_int8_t), intent(in) :: msg(*)
    integer(c_int32_t), intent(in) :: msglen
    character(kind=c_char), intent(out) :: hex(2 * SHA256_LEN)
    integer(c_int32_t) :: rc
    integer(c_int8_t) :: digest(SHA256_LEN)

    hex = '0'
    rc = capi_sha256(msg, msglen, digest)
    if (rc /= ALZ_OK) return
    call store_hex(digest, hex)
  end function capi_sha256_hex

  !> int32_t alz_hmac_sha256(const uint8_t *key, const int32_t *keylen,
  !>                         const uint8_t *msg, const int32_t *msglen, uint8_t mac[32])
  function capi_hmac_sha256(key, keylen, msg, msglen, mac) result(rc) bind(C, name='alz_hmac_sha256')
    integer(c_int8_t), intent(in) :: key(*), msg(*)
    integer(c_int32_t), intent(in) :: keylen, msglen
    integer(c_int8_t), intent(out) :: mac(SHA256_LEN)
    integer(c_int32_t) :: rc

    mac = 0_c_int8_t
    rc = ALZ_E_LENGTH
    if (.not. (valid_length(keylen) .and. valid_length(msglen))) return
    call hmac_sha256(key(1:keylen), msg(1:msglen), mac)
    rc = ALZ_OK
  end function capi_hmac_sha256

  !> int32_t alz_hmac_sha256_hex(const uint8_t *key, const int32_t *keylen,
  !>                             const uint8_t *msg, const int32_t *msglen, char hex[64])
  function capi_hmac_sha256_hex(key, keylen, msg, msglen, hex) result(rc) bind(C, name='alz_hmac_sha256_hex')
    integer(c_int8_t), intent(in) :: key(*), msg(*)
    integer(c_int32_t), intent(in) :: keylen, msglen
    character(kind=c_char), intent(out) :: hex(2 * SHA256_LEN)
    integer(c_int32_t) :: rc
    integer(c_int8_t) :: mac(SHA256_LEN)

    hex = '0'
    rc = capi_hmac_sha256(key, keylen, msg, msglen, mac)
    if (rc /= ALZ_OK) return
    call store_hex(mac, hex)
    call zeroize(mac)
  end function capi_hmac_sha256_hex

  !> int32_t alz_ct_equal(const uint8_t *a, const uint8_t *b, const int32_t *len)
  !> Returns ALZ_OK (0) when equal, ALZ_DIFFERENT (1) otherwise. A length of
  !> zero is refused: "two empty MACs are equal" is how verification bugs
  !> turn into forgeries.
  function capi_ct_equal(a, b, n) result(rc) bind(C, name='alz_ct_equal')
    integer(c_int8_t), intent(in) :: a(*), b(*)
    integer(c_int32_t), intent(in) :: n
    integer(c_int32_t) :: rc

    rc = ALZ_E_LENGTH
    if (.not. valid_length(n) .or. n < 1) return
    if (ct_equal(a(1:n), b(1:n))) then
      rc = ALZ_OK
    else
      rc = ALZ_DIFFERENT
    end if
  end function capi_ct_equal

  !> int32_t alz_hex_decode(const char *hex, const int32_t *hexlen,
  !>                        uint8_t *out, const int32_t *outcap, int32_t *outlen)
  function capi_hex_decode(hex, hexlen, out, outcap, outlen) result(rc) bind(C, name='alz_hex_decode')
    character(kind=c_char), intent(in) :: hex(*)
    integer(c_int32_t), intent(in) :: hexlen, outcap
    integer(c_int8_t), intent(inout) :: out(*)
    integer(c_int32_t), intent(out) :: outlen
    integer(c_int32_t) :: rc
    ! VOLATILE: the copy of what may be a key is wiped before it is freed,
    ! and the compiler may not drop those stores as dead.
    character(len=:), allocatable, volatile :: text
    integer :: i, n
    logical :: ok

    outlen = 0
    rc = ALZ_E_LENGTH
    if (.not. (valid_length(hexlen) .and. valid_length(outcap))) return
    rc = ALZ_E_CAPACITY
    if (hexlen / 2 > outcap) return

    allocate(character(len=hexlen) :: text)
    do i = 1, hexlen
      text(i:i) = hex(i)
    end do
    call hex_decode(text, out(1:outcap), n, ok)
    do i = 1, hexlen
      text(i:i) = '0'
    end do
    rc = ALZ_E_HEX
    if (.not. ok) return
    outlen = int(n, c_int32_t)
    rc = ALZ_OK
  end function capi_hex_decode

  !> int32_t alz_hex_encode(const uint8_t *bytes, const int32_t *len, char *hex)
  !> hex must hold 2 * len characters.
  function capi_hex_encode(bytes, n, hex) result(rc) bind(C, name='alz_hex_encode')
    integer(c_int8_t), intent(in) :: bytes(*)
    integer(c_int32_t), intent(in) :: n
    character(kind=c_char), intent(inout) :: hex(*)
    integer(c_int32_t) :: rc
    character(len=:), allocatable :: text
    integer :: i

    rc = ALZ_E_LENGTH
    if (.not. valid_length(n) .or. n > ALZ_MAX_LEN / 2) return
    allocate(character(len=2 * n) :: text)
    call hex_encode(bytes(1:n), text)
    do i = 1, 2 * n
      hex(i) = text(i:i)
    end do
    rc = ALZ_OK
  end function capi_hex_encode

  !> int32_t alz_zeroize(uint8_t *buf, const int32_t *len)
  function capi_zeroize(buf, n) result(rc) bind(C, name='alz_zeroize')
    integer(c_int8_t), intent(inout) :: buf(*)
    integer(c_int32_t), intent(in) :: n
    integer(c_int32_t) :: rc

    rc = ALZ_E_LENGTH
    if (.not. valid_length(n)) return
    call zeroize(buf(1:n))
    rc = ALZ_OK
  end function capi_zeroize

  !> int32_t alz_read_line(uint8_t *buf, const int32_t *cap, int32_t *len)
  !> One line from standard input. Bytes come from read(2), in chunks, into
  !> a buffer of this module - never stdio's or the language run time's -
  !> and each line is wiped from that buffer as soon as it is handed over,
  !> so the caller's buffer is the only copy in the process. The line feed
  !> is consumed, not stored. ALZ_OK; ALZ_E_EOF at the end of input (nothing
  !> read); ALZ_E_TRUNCATED when input ends inside a line, before its line
  !> feed; ALZ_E_CAPACITY when the line is longer than cap (the rest of it
  !> stays unread); ALZ_E_IO when read fails. In each of these cases the
  !> bytes read are wiped and len is 0.
  function capi_read_line(buf, cap, out_len) result(rc) bind(C, name='alz_read_line')
    integer(c_int8_t), intent(inout) :: buf(*)
    integer(c_int32_t), intent(in) :: cap
    integer(c_int32_t), intent(out) :: out_len
    integer(c_int32_t) :: rc
    integer(c_int8_t) :: byte
    integer :: first

    out_len = 0
    rc = ALZ_E_LENGTH
    if (.not. valid_length(cap)) return
    first = in_pos
    do
      if (in_pos > in_len) then
        if (.not. refill_input(rc, out_len == 0)) exit
        first = 1
      end if
      byte = in_buf(in_pos)
      in_pos = in_pos + 1
      if (byte == 10_c_int8_t) then
        rc = ALZ_OK
        exit
      end if
      if (out_len == cap) then
        in_pos = in_pos - 1
        rc = ALZ_E_CAPACITY
        exit
      end if
      out_len = out_len + 1
      buf(out_len) = byte
    end do
    if (in_pos > first) call zeroize(in_buf(first:in_pos - 1))
    byte = 0_c_int8_t
    if (rc /= ALZ_OK) then
      call zeroize(buf(1:out_len))
      out_len = 0
    end if
  end function capi_read_line

  !> int32_t alz_expect_eof(void) - ALZ_OK when standard input has nothing
  !> left: a program given more than it needs (a key it must not hold)
  !> refuses to run. Whatever was left is wiped.
  function capi_expect_eof() result(rc) bind(C, name='alz_expect_eof')
    integer(c_int32_t) :: rc

    if (in_pos <= in_len) then
      rc = ALZ_E_CAPACITY
      call zeroize(in_buf)
      in_pos = 1
      in_len = 0
    else if (refill_input(rc, .true.)) then
      rc = ALZ_E_CAPACITY
      call zeroize(in_buf)
      in_pos = 1
      in_len = 0
    else if (rc == ALZ_E_EOF) then
      rc = ALZ_OK
    end if
  end function capi_expect_eof

  !> int32_t alz_discard_input(void) - wipe whatever standard input this
  !> module has buffered but not handed over: a program that stops reading
  !> early (a refused batch) must not leave the rest of it in memory.
  function capi_discard_input() result(rc) bind(C, name='alz_discard_input')
    integer(c_int32_t) :: rc

    call zeroize(in_buf)
    in_pos = 1
    in_len = 0
    rc = ALZ_OK
  end function capi_discard_input

  !> Wipe the input buffer and read the next chunk into it. False at the end
  !> of input (rc ALZ_E_EOF when `clean`, i.e. nothing of a line was read
  !> yet, else ALZ_E_TRUNCATED) or on a read error (rc ALZ_E_IO).
  logical function refill_input(rc, clean)
    integer(c_int32_t), intent(out) :: rc
    logical, intent(in) :: clean
    integer(c_ptrdiff_t) :: got

    call zeroize(in_buf)
    in_pos = 1
    in_len = 0
    got = posix_read(0_c_int, c_loc(in_buf), int(IN_CHUNK, c_size_t))
    refill_input = got > 0_c_ptrdiff_t
    if (refill_input) then
      in_len = int(got)
      rc = ALZ_OK
    else if (got == 0_c_ptrdiff_t) then
      rc = merge(ALZ_E_EOF, ALZ_E_TRUNCATED, clean)
    else
      rc = ALZ_E_IO
    end if
  end function refill_input

  !> int32_t alz_selftest(void) — ALZ_OK when every known-answer test passes.
  function capi_selftest() result(rc) bind(C, name='alz_selftest')
    integer(c_int32_t) :: rc

    if (kat_all()) then
      rc = ALZ_OK
    else
      rc = ALZ_E_SELFTEST
    end if
  end function capi_selftest

  subroutine store_hex(bytes, hex)
    integer(c_int8_t), intent(in) :: bytes(SHA256_LEN)
    character(kind=c_char), intent(out) :: hex(2 * SHA256_LEN)
    character(len=2 * SHA256_LEN) :: text
    integer :: i

    call hex_encode(bytes, text)
    do i = 1, 2 * SHA256_LEN
      hex(i) = text(i:i)
    end do
  end subroutine store_hex

end module rampart_capi
