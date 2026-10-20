!=======================================================================
! risk_engine - real-time card transaction risk scoring (HARDENED)
!
! Hardened counterpart of examples/vulnerable/risk_engine.f90:
! - no shell commands (compression is left to the job scheduler);
! - session tokens come from the operating-system CSPRNG;
! - secrets are compared in constant time, lengths included;
! - the API key is read from the environment, never compiled in;
! - formats are PARAMETER constants and every I/O statement has iostat=;
! - money is integer cents and index checks are nested, not chained.
!=======================================================================
module risk_engine
  use, intrinsic :: iso_fortran_env, only: int8, int64
  use, intrinsic :: iso_c_binding, only: c_int, c_int8_t
  implicit none
  private
  public :: score_batch, new_session_token, authorize_client, ct_equal, risk_score_c

  character(len=*), parameter :: ROW_FMT = '(i8, 1x, i15)'
  integer, parameter :: TOKEN_BYTES = 16
  integer, parameter :: MAX_RECORD = 4096
  character(len=2 * TOKEN_BYTES) :: issued_token = ''

contains

  subroutine score_batch(path, report_path, status)
    character(len=*), intent(in) :: path, report_path
    integer, intent(out) :: status
    character(len=256) :: line
    integer(int64) :: exposure_cents
    integer :: u, out, i, n, ios

    status = 1
    open (newunit=u, file=path, status='old', action='read', iostat=ios)
    if (ios /= 0) return
    open (newunit=out, file=report_path, status='replace', action='write', iostat=ios)
    if (ios /= 0) then
      close (u, iostat=ios)
      return
    end if
    n = 0
    do
      read (u, '(a)', iostat=ios) line
      if (ios /= 0) exit
      n = n + 1
      i = first_nonblank(line)
      if (i == 0) cycle
      read (line(i:), *, iostat=ios) exposure_cents
      if (ios /= 0) cycle
      if (exposure_cents == 0_int64) cycle
      write (out, ROW_FMT, iostat=ios) n, exposure_cents
      if (ios /= 0) exit
    end do
    close (u, iostat=ios)
    close (out, iostat=ios)
    status = 0
  end subroutine score_batch

  !> Position of the first non-blank character, 0 when the text is blank.
  pure integer function first_nonblank(text) result(pos)
    character(len=*), intent(in) :: text
    integer :: k
    pos = 0
    do k = 1, len_trim(text)
      if (text(k:k) /= ' ') then
        pos = k
        return
      end if
    end do
  end function first_nonblank

  !> 128-bit session token from /dev/urandom, hex encoded.
  subroutine new_session_token(token, status)
    character(len=2 * TOKEN_BYTES), intent(out) :: token
    integer, intent(out) :: status
    character(len=*), parameter :: HEX_DIGITS = '0123456789abcdef'
    integer(int8) :: bytes(TOKEN_BYTES)
    integer :: u, ios, closed, k, value

    token = ''
    status = 1
    open (newunit=u, file='/dev/urandom', access='stream', form='unformatted', &
          action='read', iostat=ios)
    if (ios /= 0) return
    read (u, iostat=ios) bytes
    close (u, iostat=closed)
    if (ios /= 0) return
    do k = 1, TOKEN_BYTES
      value = iand(int(bytes(k)), 255)
      token(2 * k - 1:2 * k - 1) = HEX_DIGITS(ishft(value, -4) + 1:ishft(value, -4) + 1)
      token(2 * k:2 * k) = HEX_DIGITS(iand(value, 15) + 1:iand(value, 15) + 1)
    end do
    issued_token = token
    status = 0
  end subroutine new_session_token

  !> Constant-time equality: the running time does not depend on where
  !> the inputs differ, and different lengths never compare equal.
  pure logical function ct_equal(a, b) result(same)
    character(len=*), intent(in) :: a, b
    integer :: k, diff
    diff = ieor(len(a), len(b))
    do k = 1, min(len(a), len(b))
      diff = ior(diff, ieor(ichar(a(k:k)), ichar(b(k:k))))
    end do
    same = diff == 0
  end function ct_equal

  logical function authorize_client(presented_token, presented_key) result(ok)
    character(len=*), intent(in) :: presented_token, presented_key
    character(len=128) :: api_key
    integer :: key_len, env_status
    logical :: token_ok, key_ok

    ok = .false.
    call get_environment_variable('RISK_API_KEY', api_key, key_len, env_status)
    if (env_status /= 0 .or. key_len < 1 .or. key_len > len(api_key)) return
    token_ok = ct_equal(presented_token, issued_token)
    key_ok = ct_equal(presented_key, api_key(1:key_len))
    api_key = repeat(' ', len(api_key))
    ok = token_ok .and. key_ok
  end function authorize_client

  !> C entry point used by the gateway: scores one record in a C buffer.
  integer(c_int) function risk_score_c(buf, n) bind(c, name='risk_score') result(score)
    integer(c_int), value, intent(in) :: n
    ! watchtower-ignore ALZ-FOR-002 -- C interop needs assumed size; n is range-checked first
    integer(c_int8_t), intent(in) :: buf(*)
    integer :: k
    score = -1
    if (n < 1 .or. n > MAX_RECORD) return
    score = 0
    do k = 1, n
      if (buf(k) < 0_c_int8_t) score = score + 1
    end do
  end function risk_score_c

end module risk_engine
