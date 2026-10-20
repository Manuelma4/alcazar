! SPDX-License-Identifier: Apache-2.0
!> Constant-time comparison and secure wiping.
!>
!> Fortran's == on character data is neither constant-time nor exact: trailing
!> blanks are ignored, so 'admin' == 'admin   ' is .true. Secrets (MACs,
!> tokens, keys) must be compared as bytes with ct_equal.
module rampart_ct
  use, intrinsic :: iso_fortran_env, only: int8, int64
  use rampart_bytes, only: ub
  implicit none
  private

  public :: ct_equal, zeroize

contains

  !> .true. when a and b hold the same bytes. The running time depends only
  !> on the length (which is public), never on where the first difference is.
  function ct_equal(a, b) result(equal)
    integer(int8), intent(in) :: a(:), b(:)
    logical :: equal
    integer(int64), volatile :: acc
    integer :: i

    equal = .false.
    if (size(a) /= size(b)) return
    acc = 0_int64
    do i = 1, size(a)
      acc = ior(acc, ieor(ub(a(i)), ub(b(i))))
    end do
    equal = acc == 0_int64
  end function ct_equal

  !> Overwrite a buffer with zeros. VOLATILE keeps the compiler from deleting
  !> the stores as dead code (a common way secrets survive in memory).
  subroutine zeroize(buf)
    integer(int8), intent(inout), volatile :: buf(:)
    integer :: i

    do i = 1, size(buf)
      buf(i) = 0_int8
    end do
  end subroutine zeroize

end module rampart_ct
