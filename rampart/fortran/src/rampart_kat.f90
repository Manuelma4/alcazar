! SPDX-License-Identifier: Apache-2.0
!> Known-answer tests run at start-up (FIPS 140 style power-on self-test).
!>
!> TXNGUARD refuses to seal a ledger and Gatehouse reports itself degraded when
!> any of these fail, so a miscompiled or tampered kernel can never produce
!> MACs that look valid.
module rampart_kat
  use, intrinsic :: iso_fortran_env, only: int8, int64
  use rampart_bytes, only: bytes_of, hex_encode, hex_decode, to_byte
  use rampart_sha256, only: sha256, SHA256_LEN
  use rampart_hmac, only: hmac_sha256
  use rampart_ct, only: ct_equal
  implicit none
  private

  public :: kat_sha256, kat_hmac, kat_ct, kat_hex, kat_all

contains

  ! Every check is evaluated into its own variable before the results are
  ! combined: gfortran may short-circuit .and., which would silently skip an
  ! impure check.

  !> NIST FIPS 180-4 examples: "abc", the empty string and the 448-bit message.
  logical function kat_sha256()
    logical :: abc, empty, long

    abc = sha256_hex_of('abc') == 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    empty = sha256_hex_of('') == 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    long = sha256_hex_of('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq') == &
           '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
    kat_sha256 = abc .and. empty .and. long
  end function kat_sha256

  !> RFC 4231 test cases 1, 2 and 6 (short key, text key, key > block size).
  logical function kat_hmac()
    integer(int8) :: key1(20), key6(131)
    logical :: tc1, tc2, tc6

    key1 = to_byte(int(z'0b', int64))
    key6 = to_byte(int(z'aa', int64))
    tc1 = hmac_hex_of(key1, bytes_of('Hi There')) == &
          'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
    tc2 = hmac_hex_of(bytes_of('Jefe'), bytes_of('what do ya want for nothing?')) == &
          '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
    tc6 = hmac_hex_of(key6, bytes_of('Test Using Larger Than Block-Size Key - Hash Key First')) == &
          '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54'
    kat_hmac = tc1 .and. tc2 .and. tc6
  end function kat_hmac

  !> Constant-time comparison: equal, last byte different, different length.
  logical function kat_ct()
    integer(int8) :: a(32), b(32)
    logical :: same, last_differs, shorter

    a = bytes_of('alcazar-constant-time-self-test!')
    b = a
    same = ct_equal(a, b)
    b(32) = to_byte(0_int64)
    last_differs = .not. ct_equal(a, b)
    shorter = .not. ct_equal(a, a(1:31))
    kat_ct = same .and. last_differs .and. shorter
  end function kat_ct

  !> Hex round trip and rejection of malformed input.
  logical function kat_hex()
    integer(int8) :: out(4)
    integer :: n
    logical :: ok
    character(len=8) :: hex

    call hex_decode('00Ff7a80', out, n, ok)
    call hex_encode(out, hex)
    kat_hex = ok .and. n == 4 .and. hex == '00ff7a80'
    call hex_decode('0g', out, n, ok)
    kat_hex = kat_hex .and. .not. ok
    call hex_decode('abc', out, n, ok)
    kat_hex = kat_hex .and. .not. ok
  end function kat_hex

  logical function kat_all()
    logical :: sha, mac, ct, hex

    sha = kat_sha256()
    mac = kat_hmac()
    ct = kat_ct()
    hex = kat_hex()
    kat_all = sha .and. mac .and. ct .and. hex
  end function kat_all

  function sha256_hex_of(text) result(hex)
    character(len=*), intent(in) :: text
    character(len=2 * SHA256_LEN) :: hex
    integer(int8) :: digest(SHA256_LEN)

    call sha256(bytes_of(text), digest)
    call hex_encode(digest, hex)
  end function sha256_hex_of

  function hmac_hex_of(key, msg) result(hex)
    integer(int8), intent(in) :: key(:), msg(:)
    character(len=2 * SHA256_LEN) :: hex
    integer(int8) :: mac(SHA256_LEN)

    call hmac_sha256(key, msg, mac)
    call hex_encode(mac, hex)
  end function hmac_hex_of

end module rampart_kat
