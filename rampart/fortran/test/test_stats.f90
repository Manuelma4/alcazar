! SPDX-License-Identifier: Apache-2.0
!> Tests for the robust statistics and the JSON formatter.
program test_stats
  use, intrinsic :: iso_fortran_env, only: int64, real64
  use rampart_stats
  use rampart_json, only: json_string, json_int, json_real
  implicit none

  integer :: checks = 0, failures = 0

  call test_median_and_sort()
  call test_robust_z()
  call test_benford()
  call test_chi2()
  call test_entropy()
  call test_json()

  if (failures > 0) then
    write (*, '(a,i0,a,i0,a)') 'test_stats: ', failures, ' of ', checks, ' checks FAILED'
    error stop 1
  end if
  write (*, '(a,i0,a)') 'test_stats: ', checks, ' checks passed'

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

  logical function near(a, b, tolerance)
    real(real64), intent(in) :: a, b, tolerance

    near = abs(a - b) <= tolerance
  end function near

  subroutine test_median_and_sort()
    real(real64) :: x(9), empty(0)

    x = [5.0_real64, 3.0_real64, 9.0_real64, 1.0_real64, 7.0_real64, 2.0_real64, 8.0_real64, &
         4.0_real64, 6.0_real64]
    call expect('median odd', near(median(x), 5.0_real64, 1e-12_real64))
    call expect('median even', near(median(x(1:4)), 4.0_real64, 1e-12_real64))
    call expect('median empty', near(median(empty), 0.0_real64, 1e-12_real64))
    call sort_in_place(x)
    call expect('heapsort ascending', all(x(1:8) <= x(2:9)) .and. near(x(1), 1.0_real64, 0.0_real64))
  end subroutine test_median_and_sort

  subroutine test_robust_z()
    real(real64) :: x(5), center, scale

    x = [1.0_real64, 2.0_real64, 3.0_real64, 4.0_real64, 100.0_real64]
    call robust_scale(x, center, scale)
    call expect('robust center ignores the outlier', near(center, 3.0_real64, 1e-12_real64))
    call expect('robust scale = MAD / 0.6745', near(scale, 1.0_real64 / 0.6745_real64, 1e-9_real64))
    call expect('outlier z', near(robust_z(100.0_real64, center, scale), 97.0_real64 * 0.6745_real64, 1e-9_real64))

    x = 7.0_real64
    call robust_scale(x, center, scale)
    call expect('constant sample: z(center) = 0', near(robust_z(7.0_real64, center, scale), 0.0_real64, 0.0_real64))
    call expect('constant sample: z(other) capped', near(robust_z(8.0_real64, center, scale), 99.0_real64, 0.0_real64))

    ! MAD = 0 with outliers: the floor must be used, or identical small
    ! transfers would hide a huge one (z stayed near n / (1.25 k)).
    x = log10([100.0_real64, 100.0_real64, 100.0_real64, 900000.0_real64, 900000.0_real64])
    call robust_scale(x, center, scale, 0.25_real64)
    call expect('MAD = 0 uses the floor', near(scale, 0.25_real64, 0.0_real64))
    call expect('MAD = 0 outlier is extreme', robust_z(log10(900000.0_real64), center, scale) > 15.0_real64)
    x = log10([100.0_real64, 101.0_real64, 102.0_real64, 103.0_real64, 104.0_real64])
    call robust_scale(x, center, scale, 0.25_real64)
    call expect('floor applies to tight samples too', near(scale, 0.25_real64, 0.0_real64))
  end subroutine test_robust_z

  subroutine test_benford()
    integer :: d

    call expect('first digit 0', first_digit(0_int64) == 0)
    call expect('first digit 7', first_digit(7_int64) == 7)
    call expect('first digit 12345', first_digit(12345_int64) == 1)
    call expect('first digit of cents', first_digit(995000_int64) == 9)
    call expect('benford P(1)', near(benford_expected(1), 0.30102999566398_real64, 1e-12_real64))
    call expect('benford sums to 1', near(sum(benford_expected([(d, d = 1, 9)])), 1.0_real64, 1e-12_real64))
  end subroutine test_benford

  !> For even degrees of freedom k = 2m the survival function has a closed
  !> form: Q = exp(-x/2) * sum_{i<m} (x/2)^i / i!
  subroutine test_chi2()
    real(real64) :: x
    integer :: k

    do k = 1, 6
      x = 2.5_real64 * real(k, real64)
      call expect('chi2 sf, 8 dof, closed form', near(chi2_sf(x, 8), closed_form_q(x, 4), 1e-12_real64))
      call expect('chi2 sf, 2 dof, closed form', near(chi2_sf(x, 2), exp(-0.5_real64 * x), 1e-12_real64))
    end do
    call expect('chi2 critical value 15.507 at 8 dof', near(chi2_sf(15.507_real64, 8), 0.05_real64, 1e-4_real64))
    call expect('chi2 critical value 3.841 at 1 dof', near(chi2_sf(3.841_real64, 1), 0.05_real64, 1e-4_real64))
    call expect('chi2 critical value 7.815 at 3 dof', near(chi2_sf(7.815_real64, 3), 0.05_real64, 1e-4_real64))
    call expect('chi2 sf(0) = 1', near(chi2_sf(0.0_real64, 8), 1.0_real64, 0.0_real64))
  end subroutine test_chi2

  function closed_form_q(x, m) result(q)
    real(real64), intent(in) :: x
    integer, intent(in) :: m
    real(real64) :: q, term
    integer :: i

    term = 1.0_real64
    q = 1.0_real64
    do i = 1, m - 1
      term = term * 0.5_real64 * x / real(i, real64)
      q = q + term
    end do
    q = q * exp(-0.5_real64 * x)
  end function closed_form_q

  subroutine test_entropy()
    call expect('entropy empty', near(shannon_entropy(''), 0.0_real64, 0.0_real64))
    call expect('entropy constant', near(shannon_entropy('aaaa'), 0.0_real64, 1e-12_real64))
    call expect('entropy 2 symbols', near(shannon_entropy('abab'), 1.0_real64, 1e-12_real64))
    call expect('entropy 4 symbols', near(shannon_entropy('abcd'), 2.0_real64, 1e-12_real64))
    call expect('random token is high entropy', shannon_entropy('K7Q2M9X4V8B1N6C3Z5L0P7R2T9W4Y1') > 4.0_real64)
    call expect('IBAN is low entropy', shannon_entropy('FR7630006000011234567890189') < 4.0_real64)
  end subroutine test_entropy

  subroutine test_json()
    call expect('json 0.5 has a leading zero', json_real(0.5_real64) == '0.500000')
    call expect('json -0.25', json_real(-0.25_real64) == '-0.250000')
    call expect('json 3.5', json_real(3.5_real64) == '3.500000')
    call expect('json zero', json_real(0.0_real64) == '0')
    call expect('json tiny uses exponent', index(json_real(1.0e-9_real64), 'E-') > 0)
    call expect('json NaN is null', json_real(ieee_nan()) == 'null')
    call expect('json huge round-trips', json_real(huge(1.0_real64)) == '1.7976931348623157E+308')
    call expect('json int', json_int(-42_int64) == '-42')
    call expect('json escapes', json_string('a"b\c' // achar(10) // achar(1)) == '"a\"b\\c\u000A\u0001"')
    call expect('json escapes non-ASCII', json_string(char(233)) == '"\u00E9"')
  end subroutine test_json

  function ieee_nan() result(x)
    use, intrinsic :: ieee_arithmetic, only: ieee_value, ieee_quiet_nan
    real(real64) :: x

    x = ieee_value(x, ieee_quiet_nan)
  end function ieee_nan

end program test_stats
