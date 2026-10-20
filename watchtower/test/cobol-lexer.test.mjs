import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectCobolFormat, lexCobol } from '../src/cobol/lexer.mjs';
import { divisionRanges, execBlocks } from '../src/cobol/structure.mjs';
import { splitLines } from '../src/text.mjs';
import { fixed, fixedLine } from './helpers.mjs';

const values = (lex) => lex.tokens.map((t) => t.value);

describe('COBOL format detection', () => {
  it('treats classic column-7 layout as fixed format', () => {
    const lines = splitLines(fixed(['IDENTIFICATION DIVISION.', 'PROGRAM-ID. A.', '*comment', '    DISPLAY "X".']));
    assert.equal(detectCobolFormat(lines), 'fixed');
  });

  it('honours >>SOURCE FORMAT IS FREE and >>SOURCE FREE', () => {
    assert.equal(detectCobolFormat(['>>SOURCE FORMAT IS FREE', 'IDENTIFICATION DIVISION.']), 'free');
    assert.equal(detectCobolFormat(['      >>SOURCE FREE', 'IDENTIFICATION DIVISION.']), 'free');
  });

  it('honours $SET SOURCEFORMAT"FREE"', () => {
    assert.equal(detectCobolFormat(['      $SET SOURCEFORMAT"FREE"', 'IDENTIFICATION DIVISION.']), 'free');
    assert.equal(detectCobolFormat(['      $SET SOURCEFORMAT(FREE)', 'PROGRAM-ID. X.']), 'free');
  });

  it('sniffs free format from code starting before column 8', () => {
    const lines = ['IDENTIFICATION DIVISION.', 'PROGRAM-ID. HELLO.', 'PROCEDURE DIVISION.', '    DISPLAY "Hello".', '    STOP RUN.'];
    assert.equal(detectCobolFormat(lines), 'free');
  });
});

describe('COBOL fixed-format lexing', () => {
  it('ignores the sequence area and keeps original columns', () => {
    const lex = lexCobol('000100 MOVE WS-A TO WS-B.\n', { format: 'fixed' });
    assert.deepEqual(values(lex), ['MOVE', 'WS-A', 'TO', 'WS-B', '.']);
    assert.equal(lex.tokens[1].line, 1);
    assert.equal(lex.tokens[1].col, 13);
    assert.equal(lex.tokens[1].endCol, 17);
  });

  it('treats * and / in column 7 as comment lines and D as code', () => {
    const lex = lexCobol(fixed(['*MOVE A TO B.', '/PAGE EJECT', 'D    DISPLAY WS-DEBUG.']), { format: 'fixed' });
    assert.deepEqual(values(lex), ['DISPLAY', 'WS-DEBUG', '.']);
    assert.equal(lex.comments.length, 2);
    assert.ok(lex.comments.every((c) => c.standalone));
  });

  it('records inline *> comments but not inside literals', () => {
    const lex = lexCobol(fixed(['    DISPLAY "A *> B" *> real comment']), { format: 'fixed' });
    assert.deepEqual(values(lex), ['DISPLAY', 'A *> B']);
    assert.equal(lex.comments.length, 1);
    assert.equal(lex.comments[0].text, ' real comment');
    assert.equal(lex.comments[0].standalone, false);
  });

  it('handles doubled quotes in literals', () => {
    const lex = lexCobol(fixed(['    DISPLAY "SAY ""HI""" \'IT\'\'S\'.']), { format: 'fixed' });
    assert.deepEqual(values(lex).slice(1, 3), ['SAY "HI"', "IT'S"]);
  });

  it('continues a literal on a "-" continuation line', () => {
    const first = `    MOVE "ABC${'D'.repeat(52)}`; // exactly reaches column 72
    const lex = lexCobol(fixed([first, '-    "EFG" TO WS-X.']), { format: 'fixed' });
    const literal = lex.tokens.find((t) => t.type === 'string');
    assert.equal(literal.value, `ABC${'D'.repeat(52)}EFG`);
    assert.equal(literal.line, 1);
    assert.equal(literal.endLine, 2);
    assert.deepEqual(values(lex).slice(-3), ['TO', 'WS-X', '.']);
  });

  it('pads a continued literal with blanks up to column 72', () => {
    const lex = lexCobol(fixed(['    MOVE "AB', '-    "CD" TO WS-X.']), { format: 'fixed' });
    const literal = lex.tokens.find((t) => t.type === 'string');
    assert.equal(literal.value.length, 2 + (65 - 12) + 2); // 12 = code before the literal content
    assert.ok(literal.value.startsWith('AB ') && literal.value.endsWith(' CD'));
  });

  it('joins a word continued on the next line', () => {
    const lex = lexCobol(fixed(['    MOVE WS-LONG-NA', '-    ME TO WS-X.']), { format: 'fixed' });
    assert.deepEqual(values(lex), ['MOVE', 'WS-LONG-NAME', 'TO', 'WS-X', '.']);
  });

  it('ignores columns 73+ for tokens and records them as overflow', () => {
    const lex = lexCobol(fixed(['    MOVE A TO B|73|CHG0042']), { format: 'fixed' });
    assert.deepEqual(values(lex), ['MOVE', 'A', 'TO', 'B']);
    assert.equal(lex.overflow.length, 1);
    assert.equal(lex.overflow[0].col, 73);
    assert.equal(lex.overflow[0].text, 'CHG0042');
  });

  it('reads PICTURE strings as one token and separates the final period', () => {
    const lex = lexCobol(fixed(['01  WS-AMT PIC IS $$,$$9.99-.', '01  WS-B PICTURE S9(5)V99 COMP-3.']), { format: 'fixed' });
    const pics = lex.tokens.filter((t) => t.type === 'pic').map((t) => t.value);
    assert.deepEqual(pics, ['$$,$$9.99-', 'S9(5)V99']);
    assert.equal(lex.tokens.filter((t) => t.type === 'period').length, 2);
  });

  it('keeps paragraph names that start with digits as words', () => {
    const lex = lexCobol(fixed(['1000-INIT.', '    PERFORM 2000-RUN.']), { format: 'fixed' });
    assert.deepEqual(lex.tokens.filter((t) => t.type === 'word').map((t) => t.value), ['1000-INIT', 'PERFORM', '2000-RUN']);
  });

  it('lexes signed and decimal numeric literals', () => {
    const lex = lexCobol(fixed(['    MOVE -12.50 TO WS-A. MOVE +3 TO WS-B. MOVE .5 TO WS-C.']), { format: 'fixed' });
    assert.deepEqual(lex.tokens.filter((t) => t.type === 'number').map((t) => t.value), ['-12.50', '+3', '.5']);
  });

  it('expands tabs to 8-column stops but reports original columns', () => {
    const lex = lexCobol('\t    MOVE A TO B.\n', { format: 'fixed' });
    const move = lex.tokens[0];
    assert.equal(move.value, 'MOVE');
    assert.equal(move.col, 6);
  });

  it('switches format on a >>SOURCE directive', () => {
    const source = ['       IDENTIFICATION DIVISION.', '       >>SOURCE FORMAT IS FREE', 'PROGRAM-ID. X.', 'MOVE A TO B.'].join('\n');
    const lex = lexCobol(source, { format: 'fixed' });
    assert.ok(values(lex).includes('PROGRAM-ID'));
    assert.equal(lex.tokens.find((t) => t.value === 'MOVE').col, 1);
  });
});

describe('COBOL free-format lexing', () => {
  it('treats the whole line as code and *> as a comment', () => {
    const lex = lexCobol('MOVE A TO B. *> note\n*> standalone\n', { format: 'free' });
    assert.deepEqual(values(lex), ['MOVE', 'A', 'TO', 'B', '.']);
    assert.deepEqual(lex.comments.map((c) => c.standalone), [false, true]);
    assert.deepEqual(lex.codeLines, [1]);
  });
});

describe('COBOL structure', () => {
  it('finds division bodies and EXEC blocks', () => {
    const lex = lexCobol(fixed([
      'IDENTIFICATION DIVISION.', 'PROGRAM-ID. X.', 'DATA DIVISION.', 'WORKING-STORAGE SECTION.',
      '01  A PIC X.', 'PROCEDURE DIVISION USING A.', '    EXEC SQL SELECT 1 INTO :A FROM T.U END-EXEC', '    GOBACK.',
    ]), { format: 'fixed' });
    const ranges = divisionRanges(lex.tokens);
    assert.deepEqual(ranges.map((r) => r.name), ['IDENTIFICATION', 'DATA', 'PROCEDURE']);
    const procedure = ranges[2];
    assert.equal(lex.tokens[procedure.start].value, 'EXEC');
    const { blocks, inExec } = execBlocks(lex.tokens);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, 'SQL');
    assert.equal(inExec[procedure.start], 1);
    assert.ok(lex.tokens.some((t) => t.type === 'punct' && t.value === '.'), 'SQL dots stay punctuation');
  });

  it('treats a header-less copybook as a DATA DIVISION fragment', () => {
    const lex = lexCobol(fixed(['01  REC.', '    05  F1 PIC X.']), { format: 'fixed' });
    assert.deepEqual(divisionRanges(lex.tokens).map((r) => r.name), ['DATA']);
  });

  it('splits a pasted fragment into data and procedure parts', () => {
    const lex = lexCobol(fixed(['01  A PIC 9.', 'MOVE 1 TO A.']), { format: 'fixed' });
    assert.deepEqual(divisionRanges(lex.tokens).map((r) => r.name), ['DATA', 'PROCEDURE']);
  });

  it('builds fixed lines with the helper', () => {
    assert.equal(fixedLine('MOVE A TO B.'), '       MOVE A TO B.');
    assert.equal(fixedLine('*note'), '      *note');
    assert.equal(fixedLine('X|73|TAG').length, 75);
  });
});
