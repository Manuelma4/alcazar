! SPDX-License-Identifier: Apache-2.0
!> C ABI of the Rampart Fortran kernel — see rampart/fortran/include/alz.h.
!>
!> Every argument is passed by reference, so COBOL (CALL "alz_..." USING BY
!> REFERENCE ... RETURNING rc) and C call the same entry points. Every entry
!> point returns an int32 status (ALZ_OK or a negative ALZ_E_* code): a void
!> function would leave garbage in COBOL's RETURN-CODE. Lengths are validated
!> before any buffer is touched.
module rampart_capi
  use, intrinsic :: iso_c_binding, only: c_char, c_int8_t, c_int32_t
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
  integer(c_int32_t), parameter, public :: ALZ_E_SELFTEST = -10

  !> Upper bound for any single buffer (16 MiB): bounds the work an untrusted
  !> length can cause.
  integer(c_int32_t), parameter, public :: ALZ_MAX_LEN = 16777216

  public :: capi_sha256, capi_sha256_hex, capi_hmac_sha256, capi_hmac_sha256_hex
  public :: capi_ct_equal, capi_hex_decode, capi_hex_encode, capi_zeroize, capi_selftest

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
