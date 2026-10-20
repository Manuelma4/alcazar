! SPDX-License-Identifier: Apache-2.0
!> Robust statistics for fraud analytics.
!>
!> Medians and MADs instead of means and standard deviations: a single
!> fraudulent outlier cannot drag the baseline it is measured against.
module rampart_stats
  use, intrinsic :: iso_fortran_env, only: int64, real64
  implicit none
  private

  public :: sort_in_place, median, robust_scale, robust_z
  public :: first_digit, benford_expected, chi2_sf, shannon_entropy

  !> 0.6745 = Phi^-1(0.75): makes the MAD comparable to a standard deviation
  !> (Iglewicz & Hoaglin, 1993).
  real(real64), parameter :: MAD_FACTOR = 0.6745_real64
  !> When MAD = 0, fall back to the mean absolute deviation (scaled).
  real(real64), parameter :: MEANAD_FACTOR = 1.253314_real64
  !> |z| reported when every value is identical but x is not.
  real(real64), parameter :: Z_CAP = 99.0_real64

contains

  !> Heapsort, ascending: O(n log n) worst case, no recursion, no allocation.
  pure subroutine sort_in_place(x)
    real(real64), intent(inout) :: x(:)
    integer :: i, last
    real(real64) :: tmp

    do i = size(x) / 2, 1, -1
      call sift_down(x, i, size(x))
    end do
    do last = size(x), 2, -1
      tmp = x(1)
      x(1) = x(last)
      x(last) = tmp
      call sift_down(x, 1, last - 1)
    end do
  end subroutine sort_in_place

  pure subroutine sift_down(x, start, n)
    real(real64), intent(inout) :: x(:)
    integer, intent(in) :: start, n
    integer :: root, child
    real(real64) :: tmp

    root = start
    do while (2 * root <= n)
      child = 2 * root
      ! Fortran does not short-circuit .and.: keep the bound check in its own
      ! IF so x(child + 1) is never read out of bounds.
      if (child < n) then
        if (x(child) < x(child + 1)) child = child + 1
      end if
      if (x(root) >= x(child)) return
      tmp = x(root)
      x(root) = x(child)
      x(child) = tmp
      root = child
    end do
  end subroutine sift_down

  !> Median of x (0 for an empty array).
  pure function median(x) result(m)
    real(real64), intent(in) :: x(:)
    real(real64) :: m
    real(real64), allocatable :: s(:)
    integer :: n

    n = size(x)
    m = 0.0_real64
    if (n == 0) return
    s = x
    call sort_in_place(s)
    if (modulo(n, 2) == 1) then
      m = s((n + 1) / 2)
    else
      m = 0.5_real64 * (s(n / 2) + s(n / 2 + 1))
    end if
  end function median

  !> Robust location (median) and scale (MAD / 0.6745).
  !>
  !> When the MAD is zero (at least half the values are identical) the scale
  !> is `floor` if one is given: the usual fallback, the mean absolute
  !> deviation, is inflated by the very outliers being looked for — with
  !> k outliers among n values their z would stay near n / (1.25 k) however
  !> large they are. Without a floor that fallback is kept, scaled by 1.2533.
  pure subroutine robust_scale(x, center, scale, floor)
    real(real64), intent(in) :: x(:)
    real(real64), intent(out) :: center, scale
    real(real64), intent(in), optional :: floor
    real(real64) :: m

    center = median(x)
    scale = 0.0_real64
    if (size(x) == 0) return
    m = median(abs(x - center))
    if (m > 0.0_real64) then
      scale = m / MAD_FACTOR
      if (present(floor)) scale = max(scale, floor)
    else if (present(floor)) then
      scale = floor
    else
      scale = MEANAD_FACTOR * sum(abs(x - center)) / real(size(x), real64)
    end if
  end subroutine robust_scale

  !> Robust z-score of x against (center, scale).
  elemental function robust_z(x, center, scale) result(z)
    real(real64), intent(in) :: x, center, scale
    real(real64) :: z

    if (scale > 0.0_real64) then
      z = (x - center) / scale
    else if (abs(x - center) <= epsilon(x) * max(1.0_real64, abs(center))) then
      z = 0.0_real64
    else
      z = sign(Z_CAP, x - center)
    end if
  end function robust_z

  !> Leading (most significant) decimal digit of |v|; 0 for v = 0.
  elemental function first_digit(v) result(d)
    integer(int64), intent(in) :: v
    integer :: d
    integer(int64) :: w

    w = abs(v)
    do while (w >= 10_int64)
      w = w / 10_int64
    end do
    d = int(w)
  end function first_digit

  !> Benford's law: P(first digit = d) = log10(1 + 1/d).
  elemental function benford_expected(d) result(p)
    integer, intent(in) :: d
    real(real64) :: p

    p = log10(1.0_real64 + 1.0_real64 / real(d, real64))
  end function benford_expected

  !> Survival function of the chi-square distribution, P(X >= x).
  pure function chi2_sf(x, df) result(p)
    real(real64), intent(in) :: x
    integer, intent(in) :: df
    real(real64) :: p

    if (x <= 0.0_real64) then
      p = 1.0_real64
    else
      p = gamma_q(0.5_real64 * real(df, real64), 0.5_real64 * x)
    end if
    p = min(1.0_real64, max(0.0_real64, p))
  end function chi2_sf

  !> Regularized upper incomplete gamma function Q(a, x) for x > 0: the power
  !> series below a + 1, a continued fraction (modified Lentz) above.
  pure function gamma_q(a, x) result(q)
    real(real64), intent(in) :: a, x
    real(real64) :: q

    if (x < a + 1.0_real64) then
      q = 1.0_real64 - gamma_p_series(a, x)
    else
      q = gamma_q_fraction(a, x)
    end if
  end function gamma_q

  pure function gamma_p_series(a, x) result(p)
    real(real64), intent(in) :: a, x
    real(real64) :: p, term, total
    integer :: n

    term = 1.0_real64 / a
    total = term
    do n = 1, 1000
      term = term * x / (a + real(n, real64))
      total = total + term
      if (abs(term) < abs(total) * epsilon(total)) exit
    end do
    p = total * exp(a * log(x) - x - log_gamma(a))
  end function gamma_p_series

  pure function gamma_q_fraction(a, x) result(q)
    real(real64), intent(in) :: a, x
    real(real64) :: q, b, c, d, h, an, delta
    real(real64), parameter :: TINY_VALUE = 1.0e-300_real64
    integer :: i

    b = x + 1.0_real64 - a
    c = 1.0_real64 / TINY_VALUE
    d = 1.0_real64 / b
    h = d
    do i = 1, 1000
      an = -real(i, real64) * (real(i, real64) - a)
      b = b + 2.0_real64
      d = an * d + b
      if (abs(d) < TINY_VALUE) d = TINY_VALUE
      c = b + an / c
      if (abs(c) < TINY_VALUE) c = TINY_VALUE
      d = 1.0_real64 / d
      delta = d * c
      h = h * delta
      if (abs(delta - 1.0_real64) < epsilon(delta)) exit
    end do
    q = exp(a * log(x) - x - log_gamma(a)) * h
  end function gamma_q_fraction

  !> Shannon entropy of s in bits per character.
  pure function shannon_entropy(s) result(bits)
    character(len=*), intent(in) :: s
    real(real64) :: bits, p
    integer :: counts(0:255), i, code

    bits = 0.0_real64
    if (len(s) == 0) return
    counts = 0
    do i = 1, len(s)
      code = modulo(iachar(s(i:i)), 256)
      counts(code) = counts(code) + 1
    end do
    do i = 0, 255
      if (counts(i) > 0) then
        p = real(counts(i), real64) / real(len(s), real64)
        bits = bits - p * log(p) / log(2.0_real64)
      end if
    end do
  end function shannon_entropy

end module rampart_stats
