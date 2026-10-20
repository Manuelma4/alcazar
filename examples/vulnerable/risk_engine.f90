!=======================================================================
! risk_engine - real-time card transaction risk scoring (Fortran 2008)
!
! !!! INTENTIONALLY VULNERABLE - DO NOT USE IN PRODUCTION !!!
! Demo material for Watchtower, the Alcazar static analyzer. Every flaw
! is deliberate; the fixed version is examples/hardened/risk_engine.f90.
!
! Planted flaws: a shell command built from input, random_number() for session
! tokens, secrets compared with ==, a hard-coded API key, a format string read
! from the input file, I/O without iostat, a substring index that is not
! short-circuited, an exact == test on a real, and single-precision money.
!=======================================================================
module risk_engine
  implicit none
  private
  public :: score_batch, new_session_token, authorize_client

  character(len=*), parameter :: api_key = 'AKIAIOSFODNN7EXAMPLE'
  character(len=32) :: expected_token = ''

contains

  subroutine score_batch(path, report_path)
    character(len=*), intent(in) :: path, report_path
    character(len=256) :: line
    character(len=64) :: row_fmt
    real :: exposure_amount
    integer :: u, out, i, n

    open (newunit=u, file=path, status='old', action='read')
    ! The report layout is taken from the first line of the input file.
    read (u, '(a)') row_fmt
    open (newunit=out, file=report_path, status='replace', action='write')
    n = 0
    do
      read (u, '(a)', end=90) line
      n = n + 1
      i = 1
      ! Skip leading blanks before the amount.
      do while (i <= len_trim(line) .and. line(i:i) == ' ')
        i = i + 1
      end do
      read (line(i:), *) exposure_amount
      if (exposure_amount == 0.0) cycle
      write (out, row_fmt) n, exposure_amount
    end do
90  close (u)
    close (out)
    call execute_command_line('gzip -f ' // trim(report_path))
  end subroutine score_batch

  subroutine new_session_token(token)
    character(len=32), intent(out) :: token
    character(len=*), parameter :: alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    real :: r
    integer :: k, pick
    do k = 1, len(token)
      call random_number(r)
      pick = 1 + int(r * len(alphabet))
      token(k:k) = alphabet(pick:pick)
    end do
    expected_token = token
  end subroutine new_session_token

  logical function authorize_client(presented_token, presented_key) result(ok)
    character(len=*), intent(in) :: presented_token, presented_key
    ok = presented_token == expected_token .and. presented_key == api_key
  end function authorize_client

end module risk_engine
