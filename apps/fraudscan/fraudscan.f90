! SPDX-License-Identifier: Apache-2.0
!> FRAUDSCAN — fraud and AML analytics over the transfers TXNGUARD accepted.
!>
!>   usage: fraudscan [ACCEPTED.DAT [RISK.JSON]]
!>
!> Reads the normalized, pseudonymized ACCEPTED records (accounts are HMAC
!> tokens: this program never sees an IBAN or a card number) and writes a JSON
!> risk report: Benford first-digit test, robust z-scores, structuring,
!> velocity and memo-entropy signals.
!>
!> Money is integer cents end to end; floating point is used only for the
!> statistics. Malformed input is rejected as a whole (fail closed).
!> Exit codes, mainframe style: 0 ok, 8 malformed input, 12 limit exceeded,
!> 16 I/O error.
program fraudscan
  use, intrinsic :: iso_fortran_env, only: int64, real64, error_unit
  use rampart_stats, only: robust_scale, robust_z, median, first_digit, benford_expected, &
                       chi2_sf, shannon_entropy
  use rampart_json, only: json_string, json_int, json_real
  implicit none

  integer, parameter :: MAX_TXN = 1000
  integer, parameter :: REC_LEN = 206
  integer, parameter :: MIN_LEN = 147
  integer, parameter :: LINE_LEN = 1024
  integer, parameter :: MAX_PATH = 4096

  ! Detection thresholds (documented in docs/ARCHITECTURE.md, section 4).
  real(real64), parameter :: Z_THRESHOLD = 3.5_real64
  ! Smallest scale (log10 units) a sample may claim: a handful of similar
  ! transfers must not make a normal one look extreme. With z > 3.5 this
  ! means a transfer has to be ~7.5 times off the sender's typical amount.
  real(real64), parameter :: SCALE_FLOOR = 0.25_real64
  integer, parameter :: MIN_GROUP = 5
  integer(int64), parameter :: STRUCT_LOW = 900000_int64      ! 9,000.00
  integer(int64), parameter :: STRUCT_HIGH = 1000000_int64    ! 10,000.00
  integer, parameter :: STRUCT_COUNT = 2
  integer, parameter :: VELOCITY_COUNT = 5
  integer(int64), parameter :: VELOCITY_WINDOW = 600_int64    ! seconds
  real(real64), parameter :: ENTROPY_BITS = 4.0_real64
  integer, parameter :: ENTROPY_MIN_LEN = 20
  integer, parameter :: BENFORD_MIN = 50
  integer, parameter :: MAD_MIN = 1000
  integer, parameter :: HIST_BINS = 26
  real(real64), parameter :: HIST_STEP = 0.25_real64

  integer, parameter :: SIG_ZSCORE = 1, SIG_STRUCTURING = 2, SIG_VELOCITY = 3, SIG_ENTROPY = 4
  character(len=11), parameter :: SIGNAL_NAMES(4) = &
    [character(len=11) :: 'ZSCORE', 'STRUCTURING', 'VELOCITY', 'ENTROPY']

  type :: txn_t
    character(len=12) :: id = ''
    character(len=16) :: sender = ''
    integer(int64) :: cents = 0_int64
    integer(int64) :: epoch = 0_int64
    character(len=40) :: memo = ''
  end type txn_t

  type(txn_t), allocatable :: txns(:)
  real(real64), allocatable :: zscore(:), entropy(:)
  logical, allocatable :: has_z(:), has_entropy(:), signal(:, :)
  integer, allocatable :: score(:)
  character(len=MAX_PATH) :: in_path, out_path
  integer :: n, rc

  call parse_arguments(in_path, out_path, rc)
  if (rc /= 0) call fail(rc, 'usage: fraudscan [ACCEPTED.DAT [RISK.JSON]]')

  call read_accepted(trim(in_path), txns, n, rc)
  if (rc /= 0) call fail(rc, 'cannot read accepted transactions')

  allocate(zscore(n), entropy(n), has_z(n), has_entropy(n), signal(4, n), score(n))
  call score_amounts(txns(1:n), zscore, has_z)
  call memo_entropy(txns(1:n), entropy, has_entropy)
  signal = .false.
  signal(SIG_ZSCORE, :) = has_z .and. abs(zscore) > Z_THRESHOLD
  call flag_structuring(txns(1:n), signal(SIG_STRUCTURING, :))
  call flag_velocity(txns(1:n), signal(SIG_VELOCITY, :))
  signal(SIG_ENTROPY, :) = has_entropy .and. entropy >= ENTROPY_BITS .and. &
                           longest_token_len(txns(1:n)) >= ENTROPY_MIN_LEN
  call risk_scores(zscore, signal, score)

  call write_report(trim(out_path), txns(1:n), zscore, has_z, entropy, has_entropy, signal, score, rc)
  if (rc /= 0) call fail(rc, 'cannot write the risk report')

contains

  subroutine parse_arguments(in_path, out_path, rc)
    character(len=*), intent(out) :: in_path, out_path
    integer, intent(out) :: rc
    integer :: nargs, length, status

    in_path = 'ACCEPTED.DAT'
    out_path = 'RISK.JSON'
    rc = 0
    nargs = command_argument_count()
    if (nargs > 2) rc = 8
    if (nargs >= 1) then
      call get_command_argument(1, in_path, length, status)
      if (status /= 0 .or. length == 0) rc = 8
    end if
    if (nargs >= 2) then
      call get_command_argument(2, out_path, length, status)
      if (status /= 0 .or. length == 0) rc = 8
    end if
  end subroutine parse_arguments

  subroutine read_accepted(path, txns, n, rc)
    character(len=*), intent(in) :: path
    type(txn_t), allocatable, intent(out) :: txns(:)
    integer, intent(out) :: n, rc
    character(len=LINE_LEN) :: line
    integer :: unit, ios, lineno
    logical :: ok

    allocate(txns(MAX_TXN))
    n = 0
    rc = 16
    open (newunit=unit, file=path, status='old', action='read', form='formatted', &
          access='sequential', iostat=ios)
    if (ios /= 0) return

    lineno = 0
    do
      read (unit, '(a)', iostat=ios) line
      if (is_iostat_end(ios)) exit
      if (ios /= 0) then
        rc = 16
        exit
      end if
      lineno = lineno + 1
      if (n == MAX_TXN) then
        rc = 12
        exit
      end if
      call parse_record(line, txns(n + 1), ok)
      if (.not. ok) then
        write (error_unit, '(a,i0)') 'fraudscan: malformed record at line ', lineno
        rc = 8
        exit
      end if
      n = n + 1
    end do
    if (is_iostat_end(ios)) rc = 0
    close (unit, iostat=ios)
  end subroutine read_accepted

  !> Strict parse of one ACCEPTED record (layout in docs/ARCHITECTURE.md).
  subroutine parse_record(line, t, ok)
    character(len=*), intent(in) :: line
    type(txn_t), intent(out) :: t
    logical, intent(out) :: ok
    integer :: ios

    ok = .false.
    ! LINE SEQUENTIAL output drops trailing blanks: the card number and the
    ! memo are optional, so a record may end right after the channel.
    if (len_trim(line) > REC_LEN .or. len_trim(line) < MIN_LEN) return
    if (.not. is_identifier(line(1:12))) return
    if (.not. all_in(line(13:26), '0123456789')) return
    if (.not. all_in(line(27:42), '0123456789abcdef')) return
    if (.not. all_in(line(127:141), '0123456789')) return

    t%id = line(1:12)
    t%sender = line(27:42)
    read (line(127:141), '(i15)', iostat=ios) t%cents
    if (ios /= 0 .or. t%cents <= 0_int64) return
    call epoch_seconds(line(13:26), t%epoch, ok)
    if (.not. ok) return
    t%memo = line(167:206)
    ok = .true.
  end subroutine parse_record

  pure logical function all_in(text, allowed)
    character(len=*), intent(in) :: text, allowed

    all_in = verify(text, allowed) == 0
  end function all_in

  !> [A-Z0-9-]+ followed by blanks only.
  pure logical function is_identifier(text)
    character(len=*), intent(in) :: text
    integer :: last

    last = len_trim(text)
    is_identifier = last > 0
    if (.not. is_identifier) return
    is_identifier = verify(text(1:last), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-') == 0
  end function is_identifier

  !> YYYYMMDDHHMMSS (UTC) to seconds since 1970-01-01.
  subroutine epoch_seconds(ts, seconds, ok)
    character(len=14), intent(in) :: ts
    integer(int64), intent(out) :: seconds
    logical, intent(out) :: ok
    integer :: y, mo, d, h, mi, s, ios

    seconds = 0_int64
    read (ts, '(i4,5i2)', iostat=ios) y, mo, d, h, mi, s
    ok = ios == 0 .and. mo >= 1 .and. mo <= 12 .and. d >= 1 .and. d <= 31 .and. &
         h <= 23 .and. mi <= 59 .and. s <= 59
    if (.not. ok) return
    seconds = days_from_civil(y, mo, d) * 86400_int64 + int(h * 3600 + mi * 60 + s, int64)
  end subroutine epoch_seconds

  !> Days since 1970-01-01 in the proleptic Gregorian calendar (H. Hinnant).
  pure function days_from_civil(year, month, day) result(days)
    integer, intent(in) :: year, month, day
    integer(int64) :: days
    integer(int64) :: y, era, yoe, doy, doe, m

    y = int(year, int64)
    m = int(month, int64)
    if (m <= 2_int64) y = y - 1_int64
    era = merge(y, y - 399_int64, y >= 0_int64) / 400_int64
    yoe = y - era * 400_int64
    doy = (153_int64 * (m + merge(-3_int64, 9_int64, m > 2_int64)) + 2_int64) / 5_int64 &
          + int(day, int64) - 1_int64
    doe = yoe * 365_int64 + yoe / 4_int64 - yoe / 100_int64 + doy
    days = era * 146097_int64 + doe - 719468_int64
  end function days_from_civil

  !> Robust z-score of log10(amount): against the sender's own history when it
  !> has at least MIN_GROUP transfers, otherwise against the whole batch.
  subroutine score_amounts(txns, z, has_z)
    type(txn_t), intent(in) :: txns(:)
    real(real64), intent(out) :: z(:)
    logical, intent(out) :: has_z(:)
    real(real64) :: logs(size(txns)), center, scale, gcenter, gscale
    logical :: member(size(txns)), done(size(txns))
    integer :: i

    z = 0.0_real64
    has_z = .false.
    if (size(txns) == 0) return
    logs = log10(real(txns%cents, real64) / 100.0_real64)
    call robust_scale(logs, gcenter, gscale, SCALE_FLOOR)

    done = .false.
    do i = 1, size(txns)
      if (done(i)) cycle
      member = txns%sender == txns(i)%sender
      done = done .or. member
      if (count(member) >= MIN_GROUP) then
        call robust_scale(pack(logs, member), center, scale, SCALE_FLOOR)
        where (member) z = robust_z(logs, center, scale)
        where (member) has_z = .true.
      else if (size(txns) >= MIN_GROUP) then
        where (member) z = robust_z(logs, gcenter, gscale)
        where (member) has_z = .true.
      end if
    end do
  end subroutine score_amounts

  !> Shannon entropy of the longest blank-free token in each memo.
  subroutine memo_entropy(txns, bits, has_bits)
    type(txn_t), intent(in) :: txns(:)
    real(real64), intent(out) :: bits(:)
    logical, intent(out) :: has_bits(:)
    integer :: i, first, last

    do i = 1, size(txns)
      call longest_token(txns(i)%memo, first, last)
      has_bits(i) = last >= first
      bits(i) = 0.0_real64
      if (has_bits(i)) bits(i) = shannon_entropy(txns(i)%memo(first:last))
    end do
  end subroutine memo_entropy

  pure function longest_token_len(txns) result(lengths)
    type(txn_t), intent(in) :: txns(:)
    integer :: lengths(size(txns))
    integer :: i, first, last

    do i = 1, size(txns)
      call longest_token(txns(i)%memo, first, last)
      lengths(i) = last - first + 1
    end do
  end function longest_token_len

  !> Bounds of the longest run of non-blank characters (last < first if none).
  pure subroutine longest_token(text, first, last)
    character(len=*), intent(in) :: text
    integer, intent(out) :: first, last
    integer :: i, start

    first = 1
    last = 0
    start = 0
    do i = 1, len(text) + 1
      if (i <= len(text)) then
        if (text(i:i) /= ' ') then
          if (start == 0) start = i
          cycle
        end if
      end if
      if (start > 0) then
        if (i - start > last - first + 1) then
          first = start
          last = i - 1
        end if
        start = 0
      end if
    end do
  end subroutine longest_token

  !> Structuring ("smurfing"): repeated transfers just under the reporting
  !> threshold from the same sender.
  subroutine flag_structuring(txns, flag)
    type(txn_t), intent(in) :: txns(:)
    logical, intent(out) :: flag(:)
    logical :: under(size(txns))
    integer :: i

    under = txns%cents >= STRUCT_LOW .and. txns%cents < STRUCT_HIGH
    flag = .false.
    do i = 1, size(txns)
      if (.not. under(i)) cycle
      flag(i) = count(under .and. txns%sender == txns(i)%sender) >= STRUCT_COUNT
    end do
  end subroutine flag_structuring

  !> Velocity: VELOCITY_COUNT or more transfers from one sender within any
  !> VELOCITY_WINDOW seconds; every transfer in such a window is flagged.
  subroutine flag_velocity(txns, flag)
    type(txn_t), intent(in) :: txns(:)
    logical, intent(out) :: flag(:)
    logical :: window(size(txns))
    integer :: i

    flag = .false.
    do i = 1, size(txns)
      window = txns%sender == txns(i)%sender .and. &
               txns%epoch <= txns(i)%epoch .and. txns%epoch >= txns(i)%epoch - VELOCITY_WINDOW
      if (count(window) >= VELOCITY_COUNT) flag = flag .or. window
    end do
  end subroutine flag_velocity

  subroutine risk_scores(z, signal, score)
    real(real64), intent(in) :: z(:)
    logical, intent(in) :: signal(:, :)
    integer, intent(out) :: score(:)
    integer :: i

    do i = 1, size(score)
      score(i) = 0
      if (signal(SIG_ZSCORE, i)) score(i) = score(i) + 35 + min(25, nint(2.0_real64 * (abs(z(i)) - Z_THRESHOLD)))
      if (signal(SIG_STRUCTURING, i)) score(i) = score(i) + 30
      if (signal(SIG_VELOCITY, i)) score(i) = score(i) + 20
      if (signal(SIG_ENTROPY, i)) score(i) = score(i) + 25
      score(i) = min(100, score(i))
    end do
  end subroutine risk_scores

  subroutine write_report(path, txns, z, has_z, bits, has_bits, signal, score, rc)
    character(len=*), intent(in) :: path
    type(txn_t), intent(in) :: txns(:)
    real(real64), intent(in) :: z(:), bits(:)
    logical, intent(in) :: has_z(:), has_bits(:), signal(:, :)
    integer, intent(in) :: score(:)
    integer, intent(out) :: rc
    integer :: unit, ios, i, n

    n = size(txns)
    rc = 16
    open (newunit=unit, file=path, status='replace', action='write', form='formatted', &
          access='sequential', iostat=ios)
    if (ios /= 0) return

    write (unit, '(a)', iostat=ios) '{"schema":"alcazar.fraudscan/v1","n":' // json_int(int(n, int64)) // ','
    call write_benford(unit, txns)
    call write_amounts(unit, txns)
    write (unit, '(a)', iostat=ios) '"thresholds":{"z":' // json_real(Z_THRESHOLD) // &
      ',"zScaleFloor":' // json_real(SCALE_FLOOR) // &
      ',"structuringLowCents":' // json_int(STRUCT_LOW) // &
      ',"structuringHighCents":' // json_int(STRUCT_HIGH) // &
      ',"velocityCount":' // json_int(int(VELOCITY_COUNT, int64)) // &
      ',"velocityWindowS":' // json_int(VELOCITY_WINDOW) // &
      ',"entropyBits":' // json_real(ENTROPY_BITS) // &
      ',"entropyMinLength":' // json_int(int(ENTROPY_MIN_LEN, int64)) // '},'
    write (unit, '(a)', iostat=ios) '"transactions":['
    do i = 1, n
      write (unit, '(a)', iostat=ios) txn_json(txns(i), z(i), has_z(i), bits(i), has_bits(i), &
                                              signal(:, i), score(i)) // trim(merge(',', ' ', i < n))
    end do
    write (unit, '(a)', iostat=ios) '],"flagged":' // json_int(int(count(any(signal, dim=1)), int64)) // '}'
    if (ios /= 0) return
    close (unit, iostat=ios)
    if (ios == 0) rc = 0
  end subroutine write_report

  function txn_json(t, z, has_z, bits, has_bits, signal, score) result(out)
    type(txn_t), intent(in) :: t
    real(real64), intent(in) :: z, bits
    logical, intent(in) :: has_z, has_bits, signal(:)
    integer, intent(in) :: score
    character(len=:), allocatable :: out, list
    integer :: k

    list = ''
    do k = 1, size(signal)
      if (.not. signal(k)) cycle
      if (len(list) > 0) list = list // ','
      list = list // json_string(trim(SIGNAL_NAMES(k)))
    end do
    out = '{"id":' // json_string(trim(t%id)) // ',"score":' // json_int(int(score, int64)) // &
          ',"z":' // merge_text(json_real(z), 'null', has_z) // &
          ',"entropy":' // merge_text(json_real(bits), 'null', has_bits) // &
          ',"signals":[' // list // ']}'
  end function txn_json

  pure function merge_text(when_true, when_false, condition) result(out)
    character(len=*), intent(in) :: when_true, when_false
    logical, intent(in) :: condition
    character(len=:), allocatable :: out

    if (condition) then
      out = when_true
    else
      out = when_false
    end if
  end function merge_text

  subroutine write_benford(unit, txns)
    integer, intent(in) :: unit
    type(txn_t), intent(in) :: txns(:)
    integer :: counts(9), d, ios, n
    real(real64) :: expected(9), observed(9), chi2, mad, p_value
    character(len=:), allocatable :: verdict, basis

    n = size(txns)
    counts = 0
    do d = 1, n
      counts(first_digit(txns(d)%cents)) = counts(first_digit(txns(d)%cents)) + 1
    end do
    expected = benford_expected([(d, d = 1, 9)])
    observed = 0.0_real64
    if (n > 0) observed = real(counts, real64) / real(n, real64)
    chi2 = 0.0_real64
    if (n > 0) chi2 = sum((real(counts, real64) - real(n, real64) * expected)**2 / (real(n, real64) * expected))
    mad = sum(abs(observed - expected)) / 9.0_real64

    ! Nigrini's MAD thresholds assume thousands of amounts: at n = 200 the
    ! sampling noise alone gives MAD ~ 0.017 (> 0.015, "nonconforming"). Below
    ! MAD_MIN amounts the verdict comes from the chi-square p-value instead.
    p_value = chi2_sf(chi2, 8)
    if (n < BENFORD_MIN) then
      verdict = 'insufficient'
      basis = 'none'
    else if (n < MAD_MIN) then
      basis = 'chi2'
      if (p_value >= 0.05_real64) then
        verdict = 'acceptable'
      else if (p_value >= 0.01_real64) then
        verdict = 'marginal'
      else
        verdict = 'nonconforming'
      end if
    else
      basis = 'mad'
      if (mad <= 0.006_real64) then
        verdict = 'close'
      else if (mad <= 0.012_real64) then
        verdict = 'acceptable'
      else if (mad <= 0.015_real64) then
        verdict = 'marginal'
      else
        verdict = 'nonconforming'
      end if
    end if

    write (unit, '(a)', iostat=ios) '"benford":{"n":' // json_int(int(n, int64)) // &
      ',"counts":' // int_array(counts) // ',"observed":' // real_array(observed) // &
      ',"expected":' // real_array(expected) // ',"chi2":' // json_real(chi2) // &
      ',"pValue":' // json_real(p_value) // ',"mad":' // json_real(mad) // &
      ',"verdict":' // json_string(verdict) // ',"verdictBasis":' // json_string(basis) // '},'
  end subroutine write_benford

  subroutine write_amounts(unit, txns)
    integer, intent(in) :: unit
    type(txn_t), intent(in) :: txns(:)
    real(real64) :: cents(size(txns)), logs(size(txns)), edges(HIST_BINS + 1), med, mad
    integer :: counts(HIST_BINS), i, bin, ios
    integer(int64) :: lo, hi

    cents = real(txns%cents, real64)
    med = median(cents)
    mad = median(abs(cents - med))
    lo = 0_int64
    hi = 0_int64
    if (size(txns) > 0) then
      lo = minval(txns%cents)
      hi = maxval(txns%cents)
    end if

    edges = [(HIST_STEP * real(i, real64), i = 0, HIST_BINS)]
    counts = 0
    if (size(txns) > 0) logs = log10(cents / 100.0_real64)
    do i = 1, size(txns)
      bin = min(HIST_BINS, max(1, int(floor(logs(i) / HIST_STEP)) + 1))
      counts(bin) = counts(bin) + 1
    end do

    write (unit, '(a)', iostat=ios) '"amounts":{"medianCents":' // json_int(nint(med, int64)) // &
      ',"madCents":' // json_int(nint(mad, int64)) // ',"minCents":' // json_int(lo) // &
      ',"maxCents":' // json_int(hi) // ',"histogram":{"log10Edges":' // real_array(edges) // &
      ',"counts":' // int_array(counts) // '}},'
  end subroutine write_amounts

  function int_array(values) result(out)
    integer, intent(in) :: values(:)
    character(len=:), allocatable :: out
    integer :: i

    out = '['
    do i = 1, size(values)
      if (i > 1) out = out // ','
      out = out // json_int(int(values(i), int64))
    end do
    out = out // ']'
  end function int_array

  function real_array(values) result(out)
    real(real64), intent(in) :: values(:)
    character(len=:), allocatable :: out
    integer :: i

    out = '['
    do i = 1, size(values)
      if (i > 1) out = out // ','
      out = out // json_real(values(i))
    end do
    out = out // ']'
  end function real_array

  subroutine fail(code, message)
    integer, intent(in) :: code
    character(len=*), intent(in) :: message

    write (error_unit, '(a)') 'fraudscan: ' // message
    select case (code)
    case (8)
      stop 8, quiet=.true.
    case (12)
      stop 12, quiet=.true.
    case default
      stop 16, quiet=.true.
    end select
  end subroutine fail

end program fraudscan
