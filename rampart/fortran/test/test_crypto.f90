! SPDX-License-Identifier: Apache-2.0
!> Known-answer and property tests for the Rampart crypto kernel.
!> Expected values: NIST FIPS 180-4 examples, RFC 4231, and OpenSSL for the
!> padding-boundary lengths.
program test_crypto
  use, intrinsic :: iso_fortran_env, only: int8, int32, int64
  use rampart_bytes, only: bytes_of, hex_encode, hex_decode, to_byte, ub
  use rampart_sha256, only: sha256, sha256_ctx, sha256_init, sha256_update, sha256_final, SHA256_LEN
  use rampart_hmac, only: hmac_sha256
  use rampart_ct, only: ct_equal, zeroize
  use rampart_kat, only: kat_all
  use rampart_capi
  implicit none

  integer :: checks = 0, failures = 0

  call test_sha256_vectors()
  call test_padding_boundaries()
  call test_incremental()
  call test_hmac_rfc4231()
  call test_constant_time()
  call test_hex()
  call test_c_abi()
  call expect('power-on self-test', kat_all())

  if (failures > 0) then
    write (*, '(a,i0,a,i0,a)') 'test_crypto: ', failures, ' of ', checks, ' checks FAILED'
    error stop 1
  end if
  write (*, '(a,i0,a)') 'test_crypto: ', checks, ' checks passed'

contains

  subroutine expect(name, condition)
    character(len=*), intent(in) :: name
    logical, intent(in) :: condition

    checks = checks + 1
    if (.not. condition) then
      failures = failures + 1
      write (*, '(a)') '  FAIL ' // name
    end if
  end subroutine expect

  function sha_hex(data) result(hex)
    integer(int8), intent(in) :: data(:)
    character(len=64) :: hex
    integer(int8) :: digest(SHA256_LEN)

    call sha256(data, digest)
    call hex_encode(digest, hex)
  end function sha_hex

  function hmac_hex(key, msg) result(hex)
    integer(int8), intent(in) :: key(:), msg(:)
    character(len=64) :: hex
    integer(int8) :: mac(SHA256_LEN)

    call hmac_sha256(key, msg, mac)
    call hex_encode(mac, hex)
  end function hmac_hex

  !> Bytes (i * 7 + 3) mod 256, i = 0 .. n-1.
  function pattern(n) result(bytes)
    integer, intent(in) :: n
    integer(int8) :: bytes(n)
    integer :: i

    do i = 1, n
      bytes(i) = to_byte(int(modulo((i - 1) * 7 + 3, 256), int64))
    end do
  end function pattern

  subroutine test_sha256_vectors()
    integer(int8), allocatable :: million(:)

    call expect('sha256 "abc"', sha_hex(bytes_of('abc')) == &
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    call expect('sha256 ""', sha_hex(bytes_of('')) == &
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    call expect('sha256 448-bit', sha_hex(bytes_of('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')) == &
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
    call expect('sha256 896-bit', sha_hex(bytes_of('abcdefghbcdefghicdefghijdefghijkefghijklfghijklm' // &
      'ghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu')) == &
      'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1')
    allocate(million(1000000))
    million = to_byte(int(iachar('a'), int64))
    call expect('sha256 one million "a"', sha_hex(million) == &
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
  end subroutine test_sha256_vectors

  !> Lengths around the 55/56/64-byte padding edges (expected: OpenSSL).
  subroutine test_padding_boundaries()
    call expect('len 55', sha_hex(pattern(55)) == 'e7313d333c272e639f790978283f9eb392e843d0f29b7016828bb1daa4aac70b')
    call expect('len 56', sha_hex(pattern(56)) == '4324d65f3c103567f5589c710bc08f8523f929a9272e3af36fc968e52abc6c27')
    call expect('len 57', sha_hex(pattern(57)) == '35df609437dcfea3279283ab79fd554e2bf78f8f7ae2de532d8ee300b09e8f73')
    call expect('len 63', sha_hex(pattern(63)) == '81c80242132f230c3bd41b3e63bbcff16107339549214a99614ff26664625055')
    call expect('len 64', sha_hex(pattern(64)) == '39e3d7b6b5d075d37d053ad89b24b41bef4f3c29760c84447cab3f3be1882241')
    call expect('len 65', sha_hex(pattern(65)) == 'aacca6ff74fdbb296d165a45cecfa04e5127bc008770fbbdd48006f2d2fae95e')
    call expect('len 119', sha_hex(pattern(119)) == '9ce7368e4daf32341631b492e80359dc9f594b48453cd0dd5bf0b19279cc177e')
    call expect('len 120', sha_hex(pattern(120)) == '7836b787757e95e58b3ca5aec90b1b004e8deba1e50e9675af9cabf1a13a04b5')
    call expect('len 127', sha_hex(pattern(127)) == 'a8d23e75d936f303d248888d9b165ee543f4cbafcad3c9dd2a79bd84faa11d07')
    call expect('len 128', sha_hex(pattern(128)) == 'd2742f1f4ac6bb7ca2b239ee18402ba8b3f9f8e652d2a72973c2b9ba11c08cf6')
    call expect('len 129', sha_hex(pattern(129)) == '307f8fc2c1622b92762e818d39a185d4d667ad49a4b07ceae1f4afa008a93ec4')
  end subroutine test_padding_boundaries

  !> Feeding the data in uneven chunks must give the one-shot digest.
  subroutine test_incremental()
    integer(int8) :: data(1000), digest(SHA256_LEN)
    integer :: chunks(7) = [1, 63, 64, 65, 7, 300, 500]
    type(sha256_ctx) :: ctx
    character(len=64) :: hex
    integer :: k, pos

    data = pattern(1000)
    call sha256_init(ctx)
    pos = 1
    do k = 1, size(chunks)
      call sha256_update(ctx, data(pos:pos + chunks(k) - 1))
      pos = pos + chunks(k)
    end do
    call sha256_final(ctx, digest)
    call hex_encode(digest, hex)
    call expect('incremental == one-shot', pos == 1001 .and. hex == sha_hex(data))
  end subroutine test_incremental

  subroutine test_hmac_rfc4231()
    integer(int8) :: key20(20), key25(25), keyaa(131)
    integer(int8) :: data_dd(50), data_cd(50)
    character(len=64) :: truncated
    integer :: i

    key20 = to_byte(int(z'0b', int64))
    call expect('rfc4231 tc1', hmac_hex(key20, bytes_of('Hi There')) == &
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
    call expect('rfc4231 tc2', hmac_hex(bytes_of('Jefe'), bytes_of('what do ya want for nothing?')) == &
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
    key20 = to_byte(int(z'aa', int64))
    data_dd = to_byte(int(z'dd', int64))
    call expect('rfc4231 tc3', hmac_hex(key20, data_dd) == &
      '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe')
    key25 = [(to_byte(int(i, int64)), i = 1, 25)]
    data_cd = to_byte(int(z'cd', int64))
    call expect('rfc4231 tc4', hmac_hex(key25, data_cd) == &
      '82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b')
    key20 = to_byte(int(z'0c', int64))
    truncated = hmac_hex(key20, bytes_of('Test With Truncation'))
    call expect('rfc4231 tc5 (truncated)', truncated(1:32) == 'a3b6167473100ee06e0c796c2955552b')
    keyaa = to_byte(int(z'aa', int64))
    call expect('rfc4231 tc6', hmac_hex(keyaa, bytes_of('Test Using Larger Than Block-Size Key - Hash Key First')) == &
      '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54')
    call expect('rfc4231 tc7', hmac_hex(keyaa, bytes_of('This is a test using a larger than block-size key ' // &
      'and a larger than block-size data. The key needs to be hashed before being used by the HMAC algorithm.')) == &
      '9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2')
    call expect('64-byte key (no hashing)', hmac_hex(pattern_key64(), bytes_of('exactly one block key')) == &
      '26a5786cfe5ddabc8c51740b64ae1cee26551c8a434a87b17491485405464c6d')
  end subroutine test_hmac_rfc4231

  function pattern_key64() result(key)
    integer(int8) :: key(64)
    integer :: i

    key = [(to_byte(int(i, int64)), i = 0, 63)]
  end function pattern_key64

  subroutine test_constant_time()
    integer(int8) :: a(64), b(64), wiped(16)
    logical :: equal

    a = pattern(64)
    b = a
    call expect('ct equal', ct_equal(a, b))
    b(1) = to_byte(ub(b(1)) + 1_int64)
    call expect('ct first byte differs', .not. ct_equal(a, b))
    b = a
    b(64) = to_byte(ub(b(64)) + 128_int64)
    call expect('ct last byte differs', .not. ct_equal(a, b))
    call expect('ct length differs', .not. ct_equal(a, a(1:63)))
    call expect('ct empty', ct_equal(a(1:0), b(1:0)))
    equal = ct_equal(bytes_of('admin'), bytes_of('admin   '))
    call expect('trailing blanks: == says equal, ct_equal does not', .not. equal .and. 'admin' == 'admin   ')
    wiped = pattern(16)
    call zeroize(wiped)
    call expect('zeroize', all(wiped == 0_int8))
  end subroutine test_constant_time

  subroutine test_hex()
    integer(int8) :: out(8)
    integer :: n
    logical :: ok
    character(len=16) :: hex

    call hex_decode('DEADbeef00ff7f80', out, n, ok)
    call hex_encode(out, hex)
    call expect('hex round trip', ok .and. n == 8 .and. hex == 'deadbeef00ff7f80')
    call hex_decode('abc', out, n, ok)
    call expect('hex odd length rejected', .not. ok .and. n == 0)
    call hex_decode('zz', out, n, ok)
    call expect('hex bad digit rejected', .not. ok .and. all(out == 0_int8))
    call hex_decode('000102030405060708', out, n, ok)
    call expect('hex too long for buffer rejected', .not. ok)
  end subroutine test_hex

  !> The bind(C) entry points that COBOL calls, including their error paths.
  subroutine test_c_abi()
    integer(int8) :: msg(3), digest(32), key(32), bytes(32)
    character(len=1) :: hex(64), keyhex(64)
    character(len=64) :: text
    integer(int32) :: rc, n, cap, outlen, i

    msg = bytes_of('abc')
    n = 3
    rc = capi_sha256_hex(msg, n, hex)
    do i = 1, 64
      text(i:i) = hex(i)
    end do
    call expect('alz_sha256_hex', rc == ALZ_OK .and. &
      text == 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')

    n = -1
    rc = capi_sha256(msg, n, digest)
    call expect('alz_sha256 rejects negative length', rc == ALZ_E_LENGTH .and. all(digest == 0_int8))
    n = ALZ_MAX_LEN + 1
    rc = capi_sha256(msg, n, digest)
    call expect('alz_sha256 rejects oversized length', rc == ALZ_E_LENGTH)

    text = repeat('0f', 32)
    do i = 1, 64
      keyhex(i) = text(i:i)
    end do
    n = 64
    cap = 32
    rc = capi_hex_decode(keyhex, n, key, cap, outlen)
    call expect('alz_hex_decode', rc == ALZ_OK .and. outlen == 32 .and. all(key == 15_int8))
    cap = 16
    rc = capi_hex_decode(keyhex, n, key, cap, outlen)
    call expect('alz_hex_decode capacity', rc == ALZ_E_CAPACITY .and. outlen == 0)
    keyhex(10) = 'x'
    cap = 32
    rc = capi_hex_decode(keyhex, n, key, cap, outlen)
    call expect('alz_hex_decode bad digit', rc == ALZ_E_HEX)

    bytes = pattern(32)
    n = 32
    rc = capi_ct_equal(bytes, bytes, n)
    call expect('alz_ct_equal equal', rc == ALZ_OK)
    digest = bytes
    digest(32) = 0_int8
    rc = capi_ct_equal(bytes, digest, n)
    call expect('alz_ct_equal different', rc == ALZ_DIFFERENT)
    rc = capi_zeroize(bytes, n)
    call expect('alz_zeroize', rc == ALZ_OK .and. all(bytes == 0_int8))
    call expect('alz_selftest', capi_selftest() == ALZ_OK)
  end subroutine test_c_abi

end program test_crypto
