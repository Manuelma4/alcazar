! SPDX-License-Identifier: Apache-2.0
!> alzsum — sha256sum written in Fortran. The output format is the one
!> `sha256sum -c` / `shasum -a 256 -c` accept, so results can be checked
!> against coreutils or OpenSSL.
!>
!>   usage: alzsum FILE...
program alzsum
  use, intrinsic :: iso_fortran_env, only: int8, int64, error_unit
  use rampart_sha256, only: sha256_ctx, sha256_init, sha256_update, sha256_final, SHA256_LEN
  use rampart_bytes, only: hex_encode
  implicit none
  integer, parameter :: CHUNK = 65536
  character(len=4096) :: path
  character(len=2 * SHA256_LEN) :: hex
  integer :: i, length, status, failures
  logical :: ok

  if (command_argument_count() == 0) then
    write (error_unit, '(a)') 'usage: alzsum FILE...'
    stop 2, quiet=.true.
  end if

  failures = 0
  do i = 1, command_argument_count()
    call get_command_argument(i, path, length, status)
    if (status /= 0 .or. length == 0) then
      write (error_unit, '(a)') 'alzsum: invalid argument'
      failures = failures + 1
      cycle
    end if
    call hash_file(trim(path), hex, ok)
    if (ok) then
      write (*, '(a)') hex // '  ' // trim(path)
    else
      write (error_unit, '(a)') 'alzsum: cannot read ' // trim(path)
      failures = failures + 1
    end if
  end do
  if (failures > 0) stop 1, quiet=.true.

contains

  subroutine hash_file(path, hex, ok)
    character(len=*), intent(in) :: path
    character(len=*), intent(out) :: hex
    logical, intent(out) :: ok
    integer(int8), allocatable :: buffer(:)
    integer(int8) :: digest(SHA256_LEN)
    type(sha256_ctx) :: ctx
    integer(int64) :: total, done
    integer :: unit, ios, take

    hex = ''
    ok = .false.
    open (newunit=unit, file=path, access='stream', form='unformatted', action='read', &
          status='old', iostat=ios)
    if (ios /= 0) return
    inquire (unit=unit, size=total, iostat=ios)
    if (ios /= 0 .or. total < 0_int64) then
      close (unit, iostat=ios)
      return
    end if

    allocate(buffer(CHUNK))
    call sha256_init(ctx)
    done = 0_int64
    do while (done < total)
      take = int(min(int(CHUNK, int64), total - done))
      read (unit, iostat=ios) buffer(1:take)
      if (ios /= 0) then
        close (unit, iostat=ios)
        return
      end if
      call sha256_update(ctx, buffer(1:take))
      done = done + int(take, int64)
    end do
    close (unit, iostat=ios)
    call sha256_final(ctx, digest)
    call hex_encode(digest, hex)
    ok = .true.
  end subroutine hash_file

end program alzsum
