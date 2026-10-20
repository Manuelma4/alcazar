import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cobolProgram, findingsOf, fixed, scanCobol } from './helpers.mjs';

/**
 * @param {Parameters<typeof cobolProgram>[0]} parts
 * @param {string} ruleId
 */
function hits(parts, ruleId) {
  return findingsOf(scanCobol(cobolProgram(parts)), ruleId);
}

describe('ALZ-COB-001 dynamic CALL', () => {
  it('flags CALL with a data-item target', () => {
    const found = hits({ data: ['01  WS-PGM PIC X(8) VALUE "SUBPGM".'], procedure: ['    CALL WS-PGM USING WS-PGM'] }, 'ALZ-COB-001');
    assert.equal(found.length, 1);
    assert.equal(found[0].severity, 'high');
    assert.match(found[0].message, /WS-PGM/);
    assert.match(found[0].message, /SUBPGM/);
  });

  it('accepts literal CALL targets', () => {
    assert.equal(hits({ data: ['01  WS-A PIC X.'], procedure: ['    CALL "SUBPGM" USING WS-A', "    CALL 'OTHER'"] }, 'ALZ-COB-001').length, 0);
  });

  it('ignores CALL statements inside EXEC SQL', () => {
    assert.equal(hits({ procedure: ['    EXEC SQL CALL PROC1 END-EXEC'] }, 'ALZ-COB-001').length, 0);
  });
});

describe('ALZ-COB-002 OS command execution', () => {
  it('is critical when the command is a data item', () => {
    const found = hits({ data: ['01  WS-CMD PIC X(80).'], procedure: ['    CALL "SYSTEM" USING WS-CMD'] }, 'ALZ-COB-002');
    assert.equal(found.length, 1);
    assert.equal(found[0].severity, 'critical');
  });

  it('is medium for a literal command and covers C$SYSTEM / CBL_EXEC_RUN_UNIT', () => {
    const found = hits({
      data: ['01  WS-CMD PIC X(80).'],
      procedure: ['    CALL "system" USING "ls -l"', '    CALL "C$SYSTEM" USING BY CONTENT WS-CMD', '    CALL "CBL_EXEC_RUN_UNIT" USING "x"'],
    }, 'ALZ-COB-002');
    assert.deepEqual(found.map((f) => f.severity), ['medium', 'critical', 'medium']);
  });

  it('follows a data-item target that holds "SYSTEM"', () => {
    const found = hits({ data: ['01  WS-PGM PIC X(8) VALUE "SYSTEM".', '01  WS-CMD PIC X(80).'], procedure: ['    CALL WS-PGM USING WS-CMD'] }, 'ALZ-COB-002');
    assert.equal(found.length, 1);
  });

  it('does not flag other literal programs', () => {
    assert.equal(hits({ procedure: ['    CALL "SYSTEMS-CHECK"'] }, 'ALZ-COB-002').length, 0);
  });
});

describe('ALZ-COB-003 dynamic SQL', () => {
  it('flags PREPARE FROM :host and EXECUTE IMMEDIATE :host', () => {
    const found = hits({
      data: ['01  WS-SQL PIC X(200).'],
      procedure: ['    EXEC SQL PREPARE S1 FROM :WS-SQL END-EXEC', '    EXEC SQL', '        EXECUTE IMMEDIATE :WS-SQL', '    END-EXEC'],
    }, 'ALZ-COB-003');
    assert.equal(found.length, 2);
  });

  it('accepts static SQL and constant EXECUTE IMMEDIATE', () => {
    const found = hits({
      data: ['01  WS-ID PIC X(10).'],
      procedure: ['    EXEC SQL SELECT NAME INTO :WS-ID FROM T WHERE ID = :WS-ID END-EXEC', "    EXEC SQL EXECUTE IMMEDIATE 'DELETE FROM TMP' END-EXEC"],
    }, 'ALZ-COB-003');
    assert.equal(found.length, 0);
  });
});

describe('ALZ-COB-004 hard-coded credentials', () => {
  it('flags VALUE literals on credential-named items', () => {
    const found = hits({
      data: [
        '01  WS-DB-PASSWORD PIC X(16) VALUE "Secr3t!".',
        '01  WS-API-KEY PIC X(32) VALUE "k-123".',
        '01  WS-CARD-PIN PIC 9(4) VALUE 1234.',
        '01  AUTH-TOKEN PIC X(20) VALUE X"4142".',
      ],
    }, 'ALZ-COB-004');
    assert.equal(found.length, 4);
    assert.ok(found.every((f) => !f.message.includes('Secr3t')), 'the secret is never echoed');
  });

  it('ignores blank and figurative values, metadata names and words like SPINDLE', () => {
    const found = hits({
      data: [
        '01  WS-PASSWORD PIC X(16) VALUE SPACES.',
        '01  WS-PWD PIC X(8) VALUE LOW-VALUES.',
        '01  WS-SECRET PIC X(8) VALUE "".',
        '01  WS-PIN PIC 9(4) VALUE ZERO.',
        '01  WS-PIN-TRIES PIC 9 VALUE 3.',
        '01  WS-PASSWORD-PROMPT PIC X(20) VALUE "ENTER PASSWORD:".',
        '01  WS-TOKEN-LEN PIC 9(4) VALUE 64.',
        '01  WS-DB-PASSWORD-ENV PIC X(20) VALUE "DB_PASSWORD".',
        '01  WS-SPINDLE PIC X(4) VALUE "ABCD".',
        '01  WS-PASSWORD PIC X(8).',
      ],
    }, 'ALZ-COB-004');
    assert.equal(found.length, 0);
  });
});

describe('ALZ-COB-005 sensitive DISPLAY', () => {
  it('flags card numbers, CVV, PIN, IBAN, passwords and tokens', () => {
    const found = hits({
      data: ['01  WS-PAN PIC X(16).', '01  WS-CARD-NUM PIC X(16).', '01  WS-CVV2 PIC 999.', '01  WS-PIN PIC 9(4).', '01  EMP-IBAN PIC X(34).', '01  WS-AUTH-TOKEN PIC X(32).'],
      procedure: ['    DISPLAY "PAN " WS-PAN " " WS-CARD-NUM', '    DISPLAY WS-CVV2 WS-PIN UPON SYSERR', '    DISPLAY FUNCTION TRIM(EMP-IBAN)', '    DISPLAY WS-AUTH-TOKEN'],
    }, 'ALZ-COB-005');
    assert.equal(found.length, 6);
  });

  it('accepts masked values, lengths, literals and look-alike words', () => {
    const found = hits({
      data: ['01  WS-PAN-MASKED PIC X(16).', '01  WS-PAN PIC X(16).', '01  WS-SPINDLE PIC X.', '01  WS-COMPANY PIC X(20).', '01  WS-PIN-TRIES PIC 9.'],
      procedure: ['    DISPLAY "ENTER PIN" WS-PAN-MASKED', '    DISPLAY FUNCTION LENGTH(WS-PAN)', '    DISPLAY WS-SPINDLE WS-COMPANY WS-PIN-TRIES',
        '    DISPLAY LENGTH OF WS-PAN', '    DISPLAY WS-PAN(1:6) "******" WS-PAN(13:4)'],
    }, 'ALZ-COB-005');
    assert.equal(found.length, 0);
  });
});

describe('ALZ-COB-006 sign loss', () => {
  it('flags signed to unsigned numeric moves', () => {
    const found = hits({ data: ['01  WS-NET PIC S9(7)V99.', '01  WS-OUT PIC 9(7)V99.', '01  WS-OK PIC S9(7)V99.'], procedure: ['    MOVE WS-NET TO WS-OK WS-OUT'] }, 'ALZ-COB-006');
    assert.equal(found.length, 1);
    assert.equal(found[0].severity, 'high');
    assert.match(found[0].message, /-500\.00 becomes 500\.00/);
  });

  it('flags a negative literal into an unsigned field', () => {
    assert.equal(hits({ data: ['01  WS-OUT PIC 9(5).'], procedure: ['    MOVE -1 TO WS-OUT'] }, 'ALZ-COB-006').length, 1);
  });

  it('accepts signed receivers, unsigned senders, edited receivers and ref-mod', () => {
    const found = hits({
      data: ['01  WS-NET PIC S9(7)V99.', '01  WS-POS PIC 9(7)V99.', '01  WS-SGN PIC S9(9)V99.', '01  WS-ED PIC -(7)9.99.', '01  WS-TXT PIC X(10).'],
      procedure: ['    MOVE WS-NET TO WS-SGN WS-ED', '    MOVE WS-POS TO WS-SGN', '    MOVE WS-TXT(1:5) TO WS-POS', '    MOVE 0 TO WS-POS'],
    }, 'ALZ-COB-006');
    assert.equal(found.length, 0);
  });
});

describe('ALZ-COB-007 numeric truncation', () => {
  it('flags high-order and low-order digit loss, including edited receivers', () => {
    const found = hits({
      data: ['01  WS-BIG PIC S9(11)V99.', '01  WS-SMALL PIC S9(7)V99.', '01  WS-CENTS PIC S9(7)V9.', '01  WS-EDIT PIC ZZ,ZZ9.99.'],
      procedure: ['    MOVE WS-BIG TO WS-SMALL', '    MOVE WS-SMALL TO WS-CENTS', '    MOVE WS-SMALL TO WS-EDIT'],
    }, 'ALZ-COB-007');
    assert.equal(found.length, 3);
    assert.match(found[0].message, /11 integer digits into 7/);
    assert.match(found[1].message, /2 decimals into 1/);
  });

  it('flags numeric literals that cannot fit and shows the stored value', () => {
    const found = hits({ data: ['01  WS-SMALL PIC 9(4).', '01  WS-RATE PIC 9V99.'], procedure: ['    MOVE 123456 TO WS-SMALL', '    MOVE 1.255 TO WS-RATE'] }, 'ALZ-COB-007');
    assert.equal(found.length, 2);
    assert.match(found[0].message, /truncated to 3456/);
    assert.match(found[1].message, /truncated to 1\.25/);
  });

  it('accepts widening moves and literals that fit', () => {
    const found = hits({
      data: ['01  WS-A PIC S9(5)V99.', '01  WS-B PIC S9(9)V99.', '01  WS-C PIC 9(4).'],
      procedure: ['    MOVE WS-A TO WS-B', '    MOVE 0042 TO WS-C', '    MOVE 12.50 TO WS-B', '    MOVE ZERO TO WS-C'],
    }, 'ALZ-COB-007');
    assert.equal(found.length, 0);
  });
});

describe('ALZ-COB-008 alphanumeric truncation', () => {
  it('flags longer senders and literals', () => {
    const found = hits({
      data: ['01  WS-LONG PIC X(40).', '01  WS-SHORT PIC X(20).'],
      procedure: ['    MOVE WS-LONG TO WS-SHORT', '    MOVE "THIS LITERAL IS LONGER THAN TWENTY" TO WS-SHORT'],
    }, 'ALZ-COB-008');
    assert.equal(found.length, 2);
    assert.equal(found[0].severity, 'low');
  });

  it('accepts reference modification, groups and equal lengths', () => {
    const found = hits({
      data: ['01  WS-LONG PIC X(40).', '01  WS-SHORT PIC X(20).', '01  WS-GRP.', '    05  WS-G1 PIC X(30).', '01  WS-SAME PIC X(40).'],
      procedure: ['    MOVE WS-LONG(1:20) TO WS-SHORT', '    MOVE WS-GRP TO WS-SHORT', '    MOVE WS-LONG TO WS-SAME', '    MOVE "OK" TO WS-SHORT'],
    }, 'ALZ-COB-008');
    assert.equal(found.length, 0);
  });
});

describe('ALZ-COB-009 monetary arithmetic without ON SIZE ERROR', () => {
  it('flags ADD / SUBTRACT / MULTIPLY / COMPUTE into money fields', () => {
    const found = hits({
      data: ['01  WS-BAL PIC S9(7)V99.', '01  WS-AMT PIC S9(7)V99.', '01  WS-TOTAL PIC 9(7)V99.', '01  WS-FEE PIC 9(5)V99.'],
      procedure: ['    ADD WS-AMT TO WS-BAL', '    SUBTRACT WS-AMT FROM WS-TOTAL', '    MULTIPLY 2 BY WS-FEE', '    COMPUTE WS-BAL = WS-BAL + WS-AMT'],
    }, 'ALZ-COB-009');
    assert.equal(found.length, 4);
  });

  it('accepts ON SIZE ERROR / NOT ON SIZE ERROR and non-money receivers', () => {
    const found = hits({
      data: ['01  WS-BAL PIC S9(7)V99.', '01  WS-AMT PIC S9(7)V99.', '01  WS-COUNT PIC 9(5).', '01  WS-CHECKSUM PIC 9(4).', '01  LS-SUM PIC 9(4).'],
      procedure: [
        '    ADD WS-AMT TO WS-BAL', '        ON SIZE ERROR PERFORM ERR-PARA', '    END-ADD',
        '    ADD 1 TO WS-COUNT', '    ADD 7 TO WS-CHECKSUM', '    ADD 9 TO LS-SUM',
        '    COMPUTE WS-BAL = WS-AMT * 2', '        NOT ON SIZE ERROR CONTINUE', '    END-COMPUTE',
      ],
    }, 'ALZ-COB-009');
    assert.equal(found.length, 0);
  });

  it('accepts results that provably fit the receiver', () => {
    const found = hits({
      data: ['01  WS-INT PIC 9(13).', '01  WS-DEC PIC 99.', '01  WS-CENTS PIC 9(15).', '01  WS-A PIC 9(5)V99.', '01  WS-B PIC 9(5)V99.', '01  WS-AMT PIC 9(6)V99.'],
      procedure: ['    COMPUTE WS-CENTS = WS-INT * 100 + WS-DEC', '    ADD WS-A TO WS-B GIVING WS-AMT'],
    }, 'ALZ-COB-009');
    assert.equal(found.length, 0);
  });

  it('treats TOTAL / SUM / RATE / LIMIT as money only with decimal places', () => {
    const found = hits({
      data: ['01  WS-TOTAL-RECS PIC 9(7).', '01  WS-TOTAL PIC 9(7)V99.'],
      procedure: ['    ADD 1 TO WS-TOTAL-RECS', '    ADD 1 TO WS-TOTAL'],
    }, 'ALZ-COB-009');
    assert.equal(found.length, 1);
    assert.match(found[0].message, /WS-TOTAL /);
  });
});

describe('ALZ-COB-010 division without ON SIZE ERROR', () => {
  it('flags DIVIDE and COMPUTE with a variable divisor, without double-reporting 009', () => {
    const result = scanCobol(cobolProgram({
      data: ['01  WS-AMT PIC 9(7)V99.', '01  WS-N PIC 99.', '01  WS-PAY PIC 9(7)V99.'],
      procedure: ['    DIVIDE WS-AMT BY WS-N GIVING WS-PAY', '    COMPUTE WS-PAY = WS-AMT / (WS-N - 1)'],
    }));
    assert.equal(findingsOf(result, 'ALZ-COB-010').length, 2);
    assert.equal(findingsOf(result, 'ALZ-COB-009').length, 0);
  });

  it('accepts ON SIZE ERROR and non-zero literal divisors', () => {
    const found = hits({
      data: ['01  WS-AMT PIC 9(7)V99.', '01  WS-N PIC 99.', '01  WS-PAY PIC 9(7)V99.'],
      procedure: ['    DIVIDE WS-AMT BY WS-N GIVING WS-PAY ROUNDED', '        ON SIZE ERROR MOVE 0 TO WS-PAY', '    END-DIVIDE', '    COMPUTE WS-PAY ROUNDED = WS-AMT / 2', '    DIVIDE 4 INTO WS-AMT ROUNDED'],
    }, 'ALZ-COB-010');
    assert.equal(found.length, 0);
  });
});

describe('ALZ-COB-011 floating-point money', () => {
  it('flags COMP-1 / COMP-2 / FLOAT-LONG money fields', () => {
    const found = hits({ data: ['01  WS-BALANCE COMP-2.', '01  WS-FEE-AMT USAGE IS COMP-1.', '01  WS-INTEREST FLOAT-LONG.', '01  WS-TAX FLOAT-EXTENDED.'] }, 'ALZ-COB-011');
    assert.equal(found.length, 4);
  });

  it('accepts packed decimal money and floating point for non-money', () => {
    const found = hits({ data: ['01  WS-BALANCE PIC S9(9)V99 COMP-3.', '01  WS-ANGLE COMP-2.', '01  WS-ERROR-RATE COMP-2.'] }, 'ALZ-COB-011');
    assert.equal(found.length, 0);
  });
});

describe('ALZ-COB-012 file without FILE STATUS', () => {
  it('flags a SELECT without status', () => {
    const found = hits({ environment: ['    SELECT IN-FILE ASSIGN TO "IN.DAT"', '        ORGANIZATION IS SEQUENTIAL.'] }, 'ALZ-COB-012');
    assert.equal(found.length, 1);
    assert.equal(found[0].severity, 'low');
  });

  it('accepts FILE STATUS, bare STATUS and sort files', () => {
    const source = fixed([
      'IDENTIFICATION DIVISION.', 'PROGRAM-ID. T.', 'ENVIRONMENT DIVISION.', 'INPUT-OUTPUT SECTION.', 'FILE-CONTROL.',
      '    SELECT A-FILE ASSIGN TO "A" FILE STATUS IS WS-A-FS.', '    SELECT B-FILE ASSIGN TO "B" STATUS WS-B-FS.',
      '    SELECT SORT-FILE ASSIGN TO "SORTWK".', 'DATA DIVISION.', 'FILE SECTION.', 'FD  A-FILE.', '01  A-REC PIC X(10).',
      'FD  B-FILE.', '01  B-REC PIC X(10).', 'SD  SORT-FILE.', '01  S-REC PIC X(10).', 'WORKING-STORAGE SECTION.',
      '01  WS-A-FS PIC XX.', '01  WS-B-FS PIC XX.', 'PROCEDURE DIVISION.', '    STOP RUN.',
    ]);
    assert.equal(findingsOf(scanCobol(source), 'ALZ-COB-012').length, 0);
  });
});

describe('ALZ-COB-013 money multiplication/division without ROUNDED', () => {
  it('flags products and quotients that can drop fractions of a cent', () => {
    const found = hits({
      data: ['01  WS-BAL PIC 9(9)V99.', '01  WS-RATE PIC V9(4).', '01  WS-INTEREST-AMT PIC 9(9)V99.', '01  WS-N PIC 99.'],
      procedure: [
        '    COMPUTE WS-INTEREST-AMT = WS-BAL * WS-RATE ON SIZE ERROR CONTINUE END-COMPUTE',
        '    DIVIDE WS-BAL BY WS-N GIVING WS-INTEREST-AMT ON SIZE ERROR CONTINUE END-DIVIDE',
      ],
    }, 'ALZ-COB-013');
    assert.equal(found.length, 2);
  });

  it('accepts ROUNDED, integer receivers and products that cannot truncate', () => {
    const found = hits({
      data: ['01  WS-BAL PIC 9(9)V99.', '01  WS-RATE PIC V9(4).', '01  WS-QTY PIC 9(3).', '01  WS-PRICE PIC 9(5)V99.', '01  WS-TOTAL-AMT PIC 9(9)V99.', '01  WS-CENTS PIC 9(11).'],
      procedure: [
        '    COMPUTE WS-TOTAL-AMT ROUNDED = WS-BAL * WS-RATE ON SIZE ERROR CONTINUE END-COMPUTE',
        '    MULTIPLY WS-QTY BY WS-PRICE GIVING WS-TOTAL-AMT ON SIZE ERROR CONTINUE END-MULTIPLY',
        '    COMPUTE WS-CENTS = WS-BAL * 100 ON SIZE ERROR CONTINUE END-COMPUTE',
      ],
    }, 'ALZ-COB-013');
    assert.equal(found.length, 0);
  });
});

describe('ALZ-COB-014 code beyond column 72', () => {
  it('flags code-looking text in columns 73-80', () => {
    const result = scanCobol(cobolProgram({
      data: ['01  WS-A PIC 9.', '01  WS-OK PIC X.'],
      procedure: ['    IF WS-A > 1|73|OR WS-OK', '        MOVE 1 TO WS-A', '    END-IF', '    MOVE 2 TO WS-A|73|.', '    ADD 1 TO WS-A|73|"Y"'],
    }));
    const found = findingsOf(result, 'ALZ-COB-014');
    assert.equal(found.length, 3);
    assert.equal(found[0].column, 73);
  });

  it('accepts sequence numbers and change tags', () => {
    const found = hits({
      data: ['01  WS-A PIC 9.|73|CHG0042'],
      procedure: ['    MOVE 1 TO WS-A|73|00012300', '    MOVE 2 TO WS-A|73|PAYR0010', '    MOVE 3 TO WS-A|73|V1.2'],
    }, 'ALZ-COB-014');
    assert.equal(found.length, 0);
  });

  it('does not apply to free-format sources', () => {
    const source = `IDENTIFICATION DIVISION.\nPROGRAM-ID. T.\nPROCEDURE DIVISION.\n${' '.repeat(80)}MOVE 1 TO X.\n`;
    assert.equal(findingsOf(scanCobol(source, { format: 'free' }), 'ALZ-COB-014').length, 0);
  });
});

describe('ALZ-COB-015 ALTER', () => {
  it('flags ALTER and nothing else', () => {
    const found = hits({ procedure: ['    ALTER P1 TO PROCEED TO P2', '    GO TO P2.', 'P1.', '    GO TO P2.', 'P2.', '    EXIT.'] }, 'ALZ-COB-015');
    assert.equal(found.length, 1);
    assert.equal(hits({ procedure: ['    GO TO P2.', 'P2.', '    EXIT.'] }, 'ALZ-COB-015').length, 0);
  });
});

describe('ALZ-COB-016 LINE SEQUENTIAL record length', () => {
  const environment = ['    SELECT IN-FILE ASSIGN TO "IN.DAT"', '        ORGANIZATION IS LINE SEQUENTIAL', '        FILE STATUS IS WS-FS.'];
  /** @param {string[]} statusData @param {string[]} procedure */
  const program = (statusData, procedure) => fixed([
    'IDENTIFICATION DIVISION.', 'PROGRAM-ID. T.', 'ENVIRONMENT DIVISION.', 'INPUT-OUTPUT SECTION.', 'FILE-CONTROL.', ...environment,
    'DATA DIVISION.', 'FILE SECTION.', 'FD  IN-FILE.', '01  IN-REC PIC X(80).', 'WORKING-STORAGE SECTION.', ...statusData,
    'PROCEDURE DIVISION.', ...procedure, '    STOP RUN.',
  ]);

  it('flags input LINE SEQUENTIAL files whose status is never tested for 04/06', () => {
    const found = findingsOf(scanCobol(program(
      ['01  WS-FS PIC XX.', '    88  FS-OK VALUE "00".'],
      ['    OPEN INPUT IN-FILE', '    READ IN-FILE AT END CONTINUE END-READ', '    IF NOT FS-OK DISPLAY "ERR" END-IF'],
    )), 'ALZ-COB-016');
    assert.equal(found.length, 1);
    assert.equal(found[0].severity, 'medium');
  });

  it('accepts a direct 04/06 comparison, an EVALUATE and an 88-level', () => {
    const variants = [
      [['01  WS-FS PIC XX.'], ['    OPEN INPUT IN-FILE', '    IF WS-FS = "04" OR WS-FS = "06" PERFORM REJ END-IF']],
      [['01  WS-FS PIC XX.'], ['    OPEN I-O IN-FILE', '    EVALUATE WS-FS', '        WHEN "00" CONTINUE', '        WHEN "06" PERFORM REJ', '    END-EVALUATE']],
      [['01  WS-FS PIC XX.', '    88  FS-LENGTH VALUE "04" "06".'], ['    OPEN INPUT IN-FILE', '    IF FS-LENGTH PERFORM REJ END-IF']],
    ];
    for (const [data, procedure] of variants) {
      assert.equal(findingsOf(scanCobol(program(data, procedure)), 'ALZ-COB-016').length, 0, procedure.join(' / '));
    }
  });

  it('ignores files opened for output only and leaves missing status to ALZ-COB-012', () => {
    assert.equal(findingsOf(scanCobol(program(['01  WS-FS PIC XX.'], ['    OPEN OUTPUT IN-FILE'])), 'ALZ-COB-016').length, 0);
    const noStatus = scanCobol(cobolProgram({
      environment: ['    SELECT IN-FILE ASSIGN TO "IN.DAT" ORGANIZATION LINE SEQUENTIAL.'],
      procedure: ['    OPEN INPUT IN-FILE'],
    }));
    assert.equal(findingsOf(noStatus, 'ALZ-COB-016').length, 0);
    assert.equal(findingsOf(noStatus, 'ALZ-COB-012').length, 1);
  });
});

describe('COBOL results', () => {
  it('reports language, format and 1-based original positions', () => {
    const result = scanCobol(cobolProgram({ data: ['01  WS-PGM PIC X(8).'], procedure: ['    CALL WS-PGM'] }));
    assert.equal(result.language, 'cobol');
    assert.equal(result.format, 'fixed');
    const [finding] = findingsOf(result, 'ALZ-COB-001');
    assert.equal(finding.column, 17);
    assert.equal(finding.endColumn, 23);
    assert.equal(finding.snippet, '           CALL WS-PGM');
    assert.equal(finding.cwe, 'CWE-470');
    assert.ok(finding.fix.length > 0);
  });

  it('analyses free-format programs', () => {
    const source = '>>SOURCE FORMAT IS FREE\nIDENTIFICATION DIVISION.\nPROGRAM-ID. T.\nDATA DIVISION.\nWORKING-STORAGE SECTION.\n01 WS-PGM PIC X(8).\nPROCEDURE DIVISION.\n    CALL WS-PGM *> dynamic\n    STOP RUN.\n';
    const result = scanCobol(source);
    assert.equal(result.format, 'free');
    assert.equal(findingsOf(result, 'ALZ-COB-001').length, 1);
  });
});

describe('ALZ-COB-017 secret read with ACCEPT', () => {
  it('flags credentials and cryptographic keys read from standard input', () => {
    const found = hits({
      data: ['01  WS-PASSWORD PIC X(20).', '01  WS-PIN PIC 9(4).', '01  WS-HMAC-KEY PIC X(64).', '01  ALZ-KEY-HEX PIC X(80).',
        '01  WS-API-KEY PIC X(40).', '01  WS-AUTH-TOKEN PIC X(32).'],
      procedure: ['    ACCEPT WS-PASSWORD', '    ACCEPT WS-PIN FROM CONSOLE', '    ACCEPT WS-HMAC-KEY', '    ACCEPT ALZ-KEY-HEX',
        '    ACCEPT WS-API-KEY FROM SYSIN', '    ACCEPT WS-AUTH-TOKEN'],
    }, 'ALZ-COB-017');
    assert.equal(found.length, 6);
    assert.equal(found[0].severity, 'low');
    assert.equal(found[0].cwe, 'CWE-316');
    assert.match(found[2].message, /WS-HMAC-KEY/);
  });

  it('leaves record keys, metadata and other ACCEPT sources alone', () => {
    const found = hits({
      data: ['01  WS-CUST-KEY PIC X(10).', '01  WS-KEY-LEN PIC 99.', '01  WS-DATE PIC 9(8).', '01  WS-ARGS PIC X(80).',
        '01  WS-PASSWORD PIC X(20).', '01  WS-PIN-TRIES PIC 9.'],
      procedure: ['    ACCEPT WS-CUST-KEY', '    ACCEPT WS-KEY-LEN', '    ACCEPT WS-DATE FROM DATE YYYYMMDD', '    ACCEPT WS-ARGS FROM COMMAND-LINE',
        '    ACCEPT WS-PASSWORD FROM ENVIRONMENT "DB_PASSWORD"', '    ACCEPT WS-PIN-TRIES'],
    }, 'ALZ-COB-017');
    assert.equal(found.length, 0);
  });

  it('makes DISPLAY of a cryptographic key an ALZ-COB-005 finding', () => {
    const found = hits({ data: ['01  WS-MASTER-KEY PIC X(64).', '01  WS-CUST-KEY PIC X(10).'], procedure: ['    DISPLAY WS-MASTER-KEY WS-CUST-KEY'] }, 'ALZ-COB-005');
    assert.equal(found.length, 1);
    assert.match(found[0].message, /WS-MASTER-KEY/);
  });
});
