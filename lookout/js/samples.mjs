// Lookout · samples: two small built-in programs for the Watchtower scanner,
// used when Gatehouse cannot list the repository's examples. Every weakness
// in them is deliberate. (No real secrets: the values are obviously fake.)

const COBOL = [
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. XFERDEMO.',
  '      * Built-in Watchtower sample: a transfer step with classic',
  '      * legacy weaknesses. Every finding below is deliberate.',
  '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.',
  '       01  WS-AMOUNT-IN       PIC S9(9)V99.',
  '       01  WS-AMOUNT          PIC 9(7)V99.',
  '       01  WS-FEE             PIC 9(5)V99 VALUE 1.50.',
  '       01  WS-TOTAL           PIC 9(7)V99.',
  '       01  WS-PROG            PIC X(8).',
  '       01  WS-DB-PASSWORD     PIC X(16) VALUE "DEMO-NOT-SECRET".',
  '       01  WS-CARD-PAN        PIC X(19).',
  '       01  WS-CMD             PIC X(80).',
  '       PROCEDURE DIVISION.',
  '           ACCEPT WS-AMOUNT-IN.',
  '           ACCEPT WS-PROG.',
  '           MOVE WS-AMOUNT-IN TO WS-AMOUNT.',
  '           COMPUTE WS-TOTAL = WS-AMOUNT + WS-FEE.',
  '           DISPLAY "CARD " WS-CARD-PAN.',
  '           CALL WS-PROG USING WS-TOTAL.',
  '           CALL "SYSTEM" USING WS-CMD.',
  '           STOP RUN.',
  '',
].join('\n');

const FORTRAN = [
  '! Built-in Watchtower sample: a risk scorer with deliberate weaknesses.',
  'program riskdemo',
  '  real :: balance, limit',
  '  character(len=64) :: account, cmd',
  '  character(len=32), parameter :: db_password = "DEMO-NOT-SECRET"',
  '  limit = 1000.0',
  '  read (*, *) account, balance',
  '  if (balance == limit) then',
  '    print *, "at limit"',
  '  end if',
  '  cmd = "report " // trim(account)',
  '  call execute_command_line(cmd)',
  'end program riskdemo',
  '',
].join('\n');

export const BUILTIN_SAMPLES = Object.freeze([
  { name: 'XFERDEMO.cbl', group: 'builtin', language: 'cobol', path: 'builtin/XFERDEMO.cbl', source: COBOL },
  { name: 'riskdemo.f90', group: 'builtin', language: 'fortran', path: 'builtin/riskdemo.f90', source: FORTRAN },
]);
