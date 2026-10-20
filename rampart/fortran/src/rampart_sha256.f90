! SPDX-License-Identifier: Apache-2.0
!> SHA-256 (FIPS 180-4) in portable Fortran 2018.
!>
!> 32-bit words live in int64 variables in [0, 2**32) and every sum is masked
!> back to 32 bits, so the code never relies on signed-integer overflow, which
!> is undefined in Fortran. Checked against the NIST examples at start-up (see
!> rampart_kat) and in rampart/fortran/test/test_crypto.f90.
module rampart_sha256
  use, intrinsic :: iso_fortran_env, only: int8, int64
  use rampart_bytes, only: ub, to_byte
  implicit none
  private

  public :: sha256_ctx, sha256_init, sha256_update, sha256_final, sha256

  integer, parameter, public :: SHA256_LEN = 32
  integer, parameter, public :: SHA256_BLOCK = 64

  integer(int64), parameter :: M32 = int(z'FFFFFFFF', int64)

  integer(int64), parameter :: H0(0:7) = [ &
    int(z'6a09e667', int64), int(z'bb67ae85', int64), int(z'3c6ef372', int64), int(z'a54ff53a', int64), &
    int(z'510e527f', int64), int(z'9b05688c', int64), int(z'1f83d9ab', int64), int(z'5be0cd19', int64)]

  integer(int64), parameter :: K(0:63) = [ &
    int(z'428a2f98', int64), int(z'71374491', int64), int(z'b5c0fbcf', int64), int(z'e9b5dba5', int64), &
    int(z'3956c25b', int64), int(z'59f111f1', int64), int(z'923f82a4', int64), int(z'ab1c5ed5', int64), &
    int(z'd807aa98', int64), int(z'12835b01', int64), int(z'243185be', int64), int(z'550c7dc3', int64), &
    int(z'72be5d74', int64), int(z'80deb1fe', int64), int(z'9bdc06a7', int64), int(z'c19bf174', int64), &
    int(z'e49b69c1', int64), int(z'efbe4786', int64), int(z'0fc19dc6', int64), int(z'240ca1cc', int64), &
    int(z'2de92c6f', int64), int(z'4a7484aa', int64), int(z'5cb0a9dc', int64), int(z'76f988da', int64), &
    int(z'983e5152', int64), int(z'a831c66d', int64), int(z'b00327c8', int64), int(z'bf597fc7', int64), &
    int(z'c6e00bf3', int64), int(z'd5a79147', int64), int(z'06ca6351', int64), int(z'14292967', int64), &
    int(z'27b70a85', int64), int(z'2e1b2138', int64), int(z'4d2c6dfc', int64), int(z'53380d13', int64), &
    int(z'650a7354', int64), int(z'766a0abb', int64), int(z'81c2c92e', int64), int(z'92722c85', int64), &
    int(z'a2bfe8a1', int64), int(z'a81a664b', int64), int(z'c24b8b70', int64), int(z'c76c51a3', int64), &
    int(z'd192e819', int64), int(z'd6990624', int64), int(z'f40e3585', int64), int(z'106aa070', int64), &
    int(z'19a4c116', int64), int(z'1e376c08', int64), int(z'2748774c', int64), int(z'34b0bcb5', int64), &
    int(z'391c0cb3', int64), int(z'4ed8aa4a', int64), int(z'5b9cca4f', int64), int(z'682e6ff3', int64), &
    int(z'748f82ee', int64), int(z'78a5636f', int64), int(z'84c87814', int64), int(z'8cc70208', int64), &
    int(z'90befffa', int64), int(z'a4506ceb', int64), int(z'bef9a3f7', int64), int(z'c67178f2', int64)]

  !> Incremental hashing state. Components are private: use the procedures.
  type :: sha256_ctx
    private
    integer(int64) :: h(0:7) = H0
    integer(int8) :: block(0:SHA256_BLOCK - 1) = 0_int8
    integer :: used = 0
    integer(int64) :: nbytes = 0_int64
  end type sha256_ctx

contains

  pure subroutine sha256_init(ctx)
    type(sha256_ctx), intent(out) :: ctx

    ctx%h = H0
    ctx%block = 0_int8
    ctx%used = 0
    ctx%nbytes = 0_int64
  end subroutine sha256_init

  pure subroutine sha256_update(ctx, data)
    type(sha256_ctx), intent(inout) :: ctx
    integer(int8), intent(in) :: data(:)
    ! 64-bit positions: pos would overflow a default integer at 2**31 - 1.
    integer(int64) :: pos, total
    integer :: take

    total = size(data, kind=int64)
    ctx%nbytes = ctx%nbytes + total
    pos = 1_int64
    do while (pos <= total)
      take = int(min(int(SHA256_BLOCK - ctx%used, int64), total - pos + 1_int64))
      ctx%block(ctx%used:ctx%used + take - 1) = data(pos:pos + int(take, int64) - 1_int64)
      ctx%used = ctx%used + take
      pos = pos + int(take, int64)
      if (ctx%used == SHA256_BLOCK) then
        call compress(ctx%h, ctx%block)
        ctx%used = 0
      end if
    end do
  end subroutine sha256_update

  !> Finish the hash, write the 32-byte digest and wipe the state.
  pure subroutine sha256_final(ctx, digest)
    type(sha256_ctx), intent(inout) :: ctx
    integer(int8), intent(out) :: digest(SHA256_LEN)
    integer(int64) :: bits
    integer :: i

    bits = ctx%nbytes * 8_int64
    ctx%block(ctx%used) = to_byte(128_int64)
    ctx%used = ctx%used + 1
    if (ctx%used > SHA256_BLOCK - 8) then
      ctx%block(ctx%used:) = 0_int8
      call compress(ctx%h, ctx%block)
      ctx%used = 0
    end if
    ctx%block(ctx%used:SHA256_BLOCK - 9) = 0_int8
    do i = 0, 7
      ctx%block(SHA256_BLOCK - 1 - i) = to_byte(shiftr(bits, 8 * i))
    end do
    call compress(ctx%h, ctx%block)

    do i = 0, 7
      digest(4*i + 1) = to_byte(shiftr(ctx%h(i), 24))
      digest(4*i + 2) = to_byte(shiftr(ctx%h(i), 16))
      digest(4*i + 3) = to_byte(shiftr(ctx%h(i), 8))
      digest(4*i + 4) = to_byte(ctx%h(i))
    end do
    call sha256_init(ctx)
  end subroutine sha256_final

  !> One-shot SHA-256.
  pure subroutine sha256(data, digest)
    integer(int8), intent(in) :: data(:)
    integer(int8), intent(out) :: digest(SHA256_LEN)
    type(sha256_ctx) :: ctx

    call sha256_init(ctx)
    call sha256_update(ctx, data)
    call sha256_final(ctx, digest)
  end subroutine sha256

  pure subroutine compress(h, block)
    integer(int64), intent(inout) :: h(0:7)
    integer(int8), intent(in) :: block(0:SHA256_BLOCK - 1)
    integer(int64) :: w(0:63), a, b, c, d, e, f, g, hh, t1, t2
    integer :: t

    do t = 0, 15
      w(t) = ior(ior(shiftl(ub(block(4*t)), 24), shiftl(ub(block(4*t + 1)), 16)), &
                 ior(shiftl(ub(block(4*t + 2)), 8), ub(block(4*t + 3))))
    end do
    do t = 16, 63
      w(t) = iand(w(t - 16) + small_sigma0(w(t - 15)) + w(t - 7) + small_sigma1(w(t - 2)), M32)
    end do

    a = h(0)
    b = h(1)
    c = h(2)
    d = h(3)
    e = h(4)
    f = h(5)
    g = h(6)
    hh = h(7)
    do t = 0, 63
      t1 = iand(hh + big_sigma1(e) + ieor(g, iand(e, ieor(f, g))) + K(t) + w(t), M32)
      t2 = iand(big_sigma0(a) + ior(iand(a, b), iand(c, ior(a, b))), M32)
      hh = g
      g = f
      f = e
      e = iand(d + t1, M32)
      d = c
      c = b
      b = a
      a = iand(t1 + t2, M32)
    end do

    h(0) = iand(h(0) + a, M32)
    h(1) = iand(h(1) + b, M32)
    h(2) = iand(h(2) + c, M32)
    h(3) = iand(h(3) + d, M32)
    h(4) = iand(h(4) + e, M32)
    h(5) = iand(h(5) + f, M32)
    h(6) = iand(h(6) + g, M32)
    h(7) = iand(h(7) + hh, M32)
  end subroutine compress

  !> Rotate a 32-bit word (held in [0, 2**32)) right by n bits.
  elemental function rotr(x, n) result(r)
    integer(int64), intent(in) :: x
    integer, intent(in) :: n
    integer(int64) :: r

    r = ior(shiftr(x, n), iand(shiftl(x, 32 - n), M32))
  end function rotr

  elemental function small_sigma0(x) result(r)
    integer(int64), intent(in) :: x
    integer(int64) :: r

    r = ieor(ieor(rotr(x, 7), rotr(x, 18)), shiftr(x, 3))
  end function small_sigma0

  elemental function small_sigma1(x) result(r)
    integer(int64), intent(in) :: x
    integer(int64) :: r

    r = ieor(ieor(rotr(x, 17), rotr(x, 19)), shiftr(x, 10))
  end function small_sigma1

  elemental function big_sigma0(x) result(r)
    integer(int64), intent(in) :: x
    integer(int64) :: r

    r = ieor(ieor(rotr(x, 2), rotr(x, 13)), rotr(x, 22))
  end function big_sigma0

  elemental function big_sigma1(x) result(r)
    integer(int64), intent(in) :: x
    integer(int64) :: r

    r = ieor(ieor(rotr(x, 6), rotr(x, 11)), rotr(x, 25))
  end function big_sigma1

end module rampart_sha256
