import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scan } from '../src/index.mjs';
import { findingsOf, scanFortran } from './helpers.mjs';

/**
 * Wrap statements in a subroutine with IMPLICIT NONE.
 * @param {string[]} body
 * @param {string} [args]
 */
function sub(body, args = '') {
  return ['subroutine t(' + args + ')', '  implicit none', ...body.map((l) => `  ${l}`), 'end subroutine t', ''].join('\n');
}

/**
 * @param {string} source
 * @param {string} ruleId
 */
function hits(source, ruleId) {
  return findingsOf(scanFortran(source), ruleId);
}

describe('ALZ-FOR-001 missing IMPLICIT NONE', () => {
  it('flags programs, modules, external procedures and block data', () => {
    const source = [
      'program p', 'end program p',
      'module m', 'end module m',
      'subroutine s(x)', 'real x', 'end subroutine s',
      'pure integer(c_int) function f(x) bind(c)', 'integer x', 'f = x', 'end function f',
      'block data bd', 'end block data bd',
    ].join('\n');
    const found = hits(source, 'ALZ-FOR-001');
    assert.equal(found.length, 5);
    assert.match(found[0].message, /Program p/);
  });

  it('flags an implicit main program without a PROGRAM statement', () => {
    assert.equal(hits('x = 1\nprint *, x\nend\n', 'ALZ-FOR-001').length, 1);
  });

  it('lets module and internal procedures inherit from their host and skips interface bodies', () => {
    const source = [
      'module m', '  implicit none', '  interface', '    subroutine ext(a)', '      real :: a', '    end subroutine ext', '  end interface',
      '  type :: point', '    real :: x', '  contains', '    procedure :: norm', '  end type point',
      'contains', '  subroutine inner()', '  end subroutine inner',
      '  real function norm(self)', '    class(point), intent(in) :: self', '    norm = self%x', '  end function norm',
      'end module m',
      'program p', '  implicit none (type, external)', 'contains', '  subroutine helper()', '  end subroutine helper', 'end program p',
    ].join('\n');
    assert.equal(hits(source, 'ALZ-FOR-001').length, 0);
  });

  it('does not accept IMPLICIT NONE (EXTERNAL) or IMPLICIT REAL*8', () => {
    assert.equal(hits('program a\nimplicit none (external)\nend program a\n', 'ALZ-FOR-001').length, 1);
    assert.equal(hits('program b\nimplicit real*8 (a-h, o-z)\nend program b\n', 'ALZ-FOR-001').length, 1);
  });
});

describe('ALZ-FOR-002 assumed-size dummy arrays', () => {
  it('flags x(*), x(n,*) and dimension(*) dummies', () => {
    const source = sub(['real :: a(*)', 'real :: b(n, *)', 'real, dimension(*) :: c', 'integer :: n'], 'a, b, c, n');
    const found = hits(source, 'ALZ-FOR-002');
    assert.equal(found.length, 3);
    assert.ok(found.every((f) => f.severity === 'medium'));
  });

  it('downgrades to info inside BIND(C) procedures', () => {
    const source = [
      'subroutine c_entry(buf, n) bind(c, name="c_entry")', '  use iso_c_binding', '  implicit none',
      '  integer(c_int), value :: n', '  integer(c_int8_t), intent(in) :: buf(*)', 'end subroutine c_entry',
    ].join('\n');
    const [finding] = hits(source, 'ALZ-FOR-002');
    assert.equal(finding.severity, 'info');
    assert.match(finding.message, /C interop requires assumed-size; validate the explicit length argument/);
  });

  it('ignores assumed-length characters, assumed-shape, implied-shape parameters and non-dummies', () => {
    const source = sub([
      'character(len=*), intent(in) :: s', 'character*(*) :: s2', 'real, intent(in) :: v(:)',
      'integer, parameter :: table(*) = [1, 2, 3]', 'real :: local(10)',
    ], 's, s2, v');
    assert.equal(hits(source, 'ALZ-FOR-002').length, 0);
  });
});

describe('ALZ-FOR-003 EQUIVALENCE and ALZ-FOR-004 COMMON', () => {
  it('flags EQUIVALENCE and COMMON statements', () => {
    const result = scanFortran(sub(['real :: a, b', 'integer :: k', 'equivalence (a, k)', 'common /blk/ a, b', 'common b']));
    assert.equal(findingsOf(result, 'ALZ-FOR-003').length, 1);
    const common = findingsOf(result, 'ALZ-FOR-004');
    assert.equal(common.length, 2);
    assert.match(common[0].message, /\/blk\//);
    assert.match(common[1].message, /blank COMMON/);
  });

  it('does not confuse variables named common or equivalence with the statements', () => {
    const result = scanFortran('program p\nimplicit none\ninteger :: common, equivalence\ncommon = 1\nequivalence = 2\nend program p\n');
    assert.equal(findingsOf(result, 'ALZ-FOR-003').length + findingsOf(result, 'ALZ-FOR-004').length, 0);
  });
});

describe('ALZ-FOR-005 floating-point equality', () => {
  it('flags == / .eq. / /= / .ne. against real literals', () => {
    const source = sub(['real :: x', 'if (x == 0.0) x = 1', 'if (x .eq. 1.d0) x = 1', 'if (1e-3 /= x) x = 1', 'if (x .ne. -0.5_dp) x = 1', 'if (x == 0.) x = 1']);
    assert.equal(hits(source, 'ALZ-FOR-005').length, 5);
  });

  it('accepts integer literals, tolerances and relational operators', () => {
    const source = sub(['real :: x', 'integer :: i', 'if (i == 0) x = 1', 'if (abs(x - 1.0) < 1.0e-6) x = 2', 'if (x > 0.0) x = 3', 'if (i == 0_8) x = 4']);
    assert.equal(hits(source, 'ALZ-FOR-005').length, 0);
  });
});

describe('ALZ-FOR-006 I/O without IOSTAT', () => {
  it('flags OPEN and READ always, and file WRITE / CLOSE / INQUIRE', () => {
    const source = sub([
      'integer :: u, ios', 'real :: x', "open (newunit=u, file='a.dat')", 'read (u, *) x', 'read *, x',
      'read (u, *, end=10, err=20) x', "write (u, '(f8.2)') x", 'close (u)', "inquire (file='a.dat', exist=ok)", '10 continue', '20 continue',
    ]);
    const found = hits(source, 'ALZ-FOR-006');
    assert.equal(found.length, 7);
    assert.match(found[3].message, /ERR=\/END=/);
  });

  it('accepts iostat=, console units and internal WRITEs', () => {
    const source = sub([
      'use iso_fortran_env, only: output_unit, error_unit', 'integer :: u, ios', 'real :: x', 'character(len=20) :: buf',
      "open (newunit=u, file='a.dat', iostat=ios)", 'read (u, *, iostat=ios) x', "write (*, '(a)') 'ok'", 'write (6, *) x', 'write (0, *) x',
      'write (output_unit, *) x', 'write (error_unit, *) x', 'print *, x', "write (buf, '(f8.2)') x", 'close (u, iostat=ios)',
      'inquire (iolength=ios) x',
    ]);
    assert.equal(hits(source, 'ALZ-FOR-006').length, 0);
  });

  it('applies to the action of a logical IF', () => {
    assert.equal(hits(sub(['integer :: u', 'real :: x', 'if (u > 0) read (u, *) x']), 'ALZ-FOR-006').length, 1);
  });
});

describe('ALZ-FOR-007 command execution', () => {
  it('is high for a computed command and medium for a literal', () => {
    const source = sub(['character(len=80) :: cmd', 'call execute_command_line(cmd)', "call execute_command_line('ls ' // trim(cmd), wait=.true.)",
      "call execute_command_line('date')", "call system('ls')", 'call system(cmd)', "call execute_command_line(command='uptime')"]);
    assert.deepEqual(hits(source, 'ALZ-FOR-007').map((f) => f.severity), ['high', 'high', 'medium', 'medium', 'high', 'medium']);
  });

  it('ignores other calls', () => {
    assert.equal(hits(sub(['call system_clock(i)', 'call systematic(x)']), 'ALZ-FOR-007').length, 0);
  });
});

describe('ALZ-FOR-008 non-constant-time secret comparison', () => {
  it('flags == on passwords, tokens, MACs and digests and explains trailing blanks', () => {
    const source = sub(['character(len=32) :: password, input, expected_token, mac, hmac_tag, sig', 'logical :: ok',
      'ok = input == password', 'if (expected_token .ne. input) return', 'ok = mac == hmac_tag', 'ok = cfg%api_key == input']);
    const found = hits(source, 'ALZ-FOR-008');
    assert.equal(found.length, 4);
    assert.match(found[0].message, /"admin" == "admin   " is \.true\./);
  });

  it('accepts lengths, blank checks, look-alike names and known-answer tests', () => {
    const source = sub(['character(len=32) :: password, machine, token_kind', 'integer :: n_token', 'logical :: ok',
      'ok = len_trim(password) == 0', "ok = password == ''", 'ok = machine == token_kind', 'ok = n_token == 3', 'ok = size(tokens) /= 2',
      "ok = hmac_hex(key, msg) == 'b0344c61d8db38535ca8afceaf0bf12b'"]);
    assert.equal(hits(source, 'ALZ-FOR-008').length, 0);
  });
});

describe('ALZ-FOR-009 hard-coded credentials', () => {
  it('flags character variables, PARAMETER and DATA initialised with literals', () => {
    const source = sub(["character(len=*), parameter :: api_key = 'k-123'", "character(len=16) :: db_password = 'hunter2'",
      'character(len=8) :: secret', "parameter (secret = 'xyz')", 'character(len=8) :: auth_token', "data auth_token /'abc'/"]);
    assert.equal(hits(source, 'ALZ-FOR-009').length, 4);
  });

  it('ignores blank values, non-character types, prompts and environment variable names', () => {
    const source = sub(["character(len=16) :: password = ''", 'integer :: token_count = 0', "character(len=*), parameter :: password_prompt = 'Password: '",
      "character(len=*), parameter :: secret_env_var = 'APP_SECRET'", "character(len=8) :: user = 'admin'"]);
    assert.equal(hits(source, 'ALZ-FOR-009').length, 0);
  });
});

describe('ALZ-FOR-010 single-precision money', () => {
  it('flags default, *4, (4), (sp), (real32) and kind=4 REALs with money names', () => {
    const source = sub(['real :: balance', 'real*4 :: fee', 'real(4) :: tax_amount', 'real(sp) :: price', 'real(kind=real32) :: payment', 'real(kind=4) :: salary']);
    assert.equal(hits(source, 'ALZ-FOR-010').length, 6);
  });

  it('flags a single-precision function returning money', () => {
    assert.equal(hits('real function interest(b)\nimplicit none\nreal, intent(in) :: b\ninterest = b\nend function interest\n', 'ALZ-FOR-010').length, 1);
  });

  it('accepts double precision, integer cents and non-money names', () => {
    const source = sub(['real(dp) :: balance', 'double precision :: fee', 'real(kind=8) :: tax', 'integer(int64) :: amount', 'real :: costheta, total']);
    assert.equal(hits(source, 'ALZ-FOR-010').length, 0);
  });
});

describe('ALZ-FOR-011 runtime format strings', () => {
  it('flags formats held in character variables', () => {
    const source = sub(['character(len=40) :: fmt', 'integer :: u', 'real :: x', 'write (u, fmt, iostat=u) x', 'read (u, fmt=fmt, iostat=u) x', 'print fmt, x']);
    assert.equal(hits(source, 'ALZ-FOR-011').length, 3);
  });

  it('accepts literals, labels, *, PARAMETER formats (also from the host) and namelists', () => {
    const source = [
      'module m', '  implicit none', "  character(len=*), parameter :: ROW = '(i8, f10.2)'", 'contains', '  subroutine s(u, x)',
      '    integer, intent(in) :: u', '    real, intent(in) :: x', '    character(len=*), parameter :: LOCAL_FMT = "(a)"', '    integer :: ios',
      '    namelist /cfg/ x', '    write (u, ROW, iostat=ios) 1, x', '    write (u, LOCAL_FMT, iostat=ios) "x"', "    write (u, '(a)', iostat=ios) 'y'",
      '    write (u, 100, iostat=ios) x', '100 format (f8.2)', '    write (u, *, iostat=ios) x', '    write (u, nml=cfg, iostat=ios)', '    print *, x',
      '  end subroutine s', 'end module m',
    ].join('\n');
    assert.equal(hits(source, 'ALZ-FOR-011').length, 0);
  });
});

describe('ALZ-FOR-012 weak PRNG for secrets', () => {
  it('flags random_number / rand in procedures handling tokens, keys, nonces or sessions', () => {
    const source = [
      'module m', '  implicit none', 'contains',
      '  subroutine new_session_token(tok)', '    character(len=16), intent(out) :: tok', '    real :: r', '    call random_number(r)', '  end subroutine',
      '  subroutine make_nonce(n)', '    integer, intent(out) :: n', '    n = int(rand(0) * 1000)', '  end subroutine',
      'end module m',
    ].join('\n');
    assert.equal(hits(source, 'ALZ-FOR-012').length, 2);
  });

  it('ignores PRNG use for simulations and words like keyboard', () => {
    const source = [
      'module sim', '  implicit none', '  character(len=*), parameter :: api_key_name = "SIM_KEY"', 'contains',
      '  subroutine monte_carlo(estimate)', '    real, intent(out) :: estimate', '    real :: r(1000)', '    call random_number(r)',
      '    estimate = sum(r) / 1000.0', '  end subroutine',
      '  subroutine keyboard_demo(x)', '    real, intent(out) :: x', '    call random_number(x)', '  end subroutine',
      'end module sim',
    ].join('\n');
    assert.equal(hits(source, 'ALZ-FOR-012').length, 0);
  });
});

describe('ALZ-FOR-013 obsolescent control flow', () => {
  it('flags arithmetic IF, computed GO TO, assigned GO TO and ASSIGN', () => {
    const source = ['      PROGRAM P', '      IMPLICIT NONE', '      INTEGER I, K', '      IF (I - 1) 10, 20, 30', '   10 GO TO (20, 30), I',
      '   20 ASSIGN 30 TO K', '      GO TO K', '   30 CONTINUE', '      END'].join('\n');
    assert.equal(findingsOf(scan(source, { filename: 'p.f' }), 'ALZ-FOR-013').length, 4);
  });

  it('accepts block IF, logical IF and plain GO TO', () => {
    const source = sub(['integer :: i', 'if (i > 1) then', '  i = 1', 'end if', 'if (i == 2) go to 10', 'goto 10', '10 continue']);
    assert.equal(hits(source, 'ALZ-FOR-013').length, 0);
  });
});

describe('ALZ-FOR-014 bound checks without short-circuit', () => {
  it('flags an index guard and an access in the same .and./.or. chain', () => {
    const source = sub([
      'integer, intent(in) :: n', 'real, intent(in) :: a(n)', 'character(len=*), intent(in) :: s', 'integer :: i', 'logical :: ok',
      'if (i <= n .and. a(i) > 0) i = 1', 'if (i > n .or. a(i) == 0.5) i = 2', 'do while (i <= len_trim(s) .and. s(i:i) == " ")',
      '  i = i + 1', 'end do', 'ok = (i < size(a)) .and. (a(i + 1) > a(i))', 'if (a(i) > 0 .and. i >= 1) i = 3',
    ], 'n, a, s');
    const found = hits(source, 'ALZ-FOR-014');
    assert.equal(found.length, 5);
    assert.ok(found.every((f) => f.severity === 'medium'));
    assert.match(found[0].message, /a\(i\) may be evaluated even when "i <= n" is false/);
  });

  it('accepts nested IFs, function calls and unrelated indexes', () => {
    const source = sub([
      'integer, intent(in) :: n', 'real, intent(in) :: a(n)', 'character(len=*), intent(in) :: s', 'integer :: i, j',
      'if (i <= n) then', '  if (a(i) > 0) i = 1', 'end if', 'if (i <= n .and. f(i) > 0) i = 2', 'if (i <= n .and. a(j) > 0) i = 3',
      'if (i > 0 .and. s(1:i) == "x") i = 4', 'if (i <= n) i = 5',
    ], 'n, a, s');
    assert.equal(hits(source, 'ALZ-FOR-014').length, 0);
  });
});

describe('Fortran results', () => {
  it('detects the source form from the extension', () => {
    assert.equal(scan('      PROGRAM P\n      IMPLICIT NONE\n      END\n', { filename: 'p.F77' }).format, 'fixed');
    assert.equal(scan('program p\nimplicit none\nend program p\n', { filename: 'p.F90' }).format, 'free');
  });
});
