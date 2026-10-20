! SPDX-License-Identifier: Apache-2.0
!> HMAC-SHA256 (RFC 2104), checked against the RFC 4231 test cases.
module rampart_hmac
  use, intrinsic :: iso_fortran_env, only: int8, int64
  use rampart_bytes, only: ub, to_byte
  use rampart_sha256, only: sha256_ctx, sha256_init, sha256_update, sha256_final, sha256, &
                        SHA256_LEN, SHA256_BLOCK
  use rampart_ct, only: zeroize
  implicit none
  private

  public :: hmac_sha256

  integer(int64), parameter :: IPAD = int(z'36', int64)
  integer(int64), parameter :: OPAD = int(z'5c', int64)

contains

  !> mac = HMAC-SHA256(key, msg). Intermediate key material is wiped.
  subroutine hmac_sha256(key, msg, mac)
    integer(int8), intent(in) :: key(:), msg(:)
    integer(int8), intent(out) :: mac(SHA256_LEN)
    integer(int8) :: k0(SHA256_BLOCK), pad(SHA256_BLOCK), inner(SHA256_LEN)
    type(sha256_ctx) :: ctx

    k0 = 0_int8
    if (size(key) > SHA256_BLOCK) then
      call sha256(key, k0(1:SHA256_LEN))
    else
      k0(1:size(key)) = key
    end if

    pad = to_byte(ieor(ub(k0), IPAD))
    call sha256_init(ctx)
    call sha256_update(ctx, pad)
    call sha256_update(ctx, msg)
    call sha256_final(ctx, inner)

    pad = to_byte(ieor(ub(k0), OPAD))
    call sha256_init(ctx)
    call sha256_update(ctx, pad)
    call sha256_update(ctx, inner)
    call sha256_final(ctx, mac)

    call zeroize(k0)
    call zeroize(pad)
    call zeroize(inner)
  end subroutine hmac_sha256

end module rampart_hmac
