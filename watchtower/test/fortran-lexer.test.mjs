import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sniffFortranFormat } from '../src/detect.mjs';
import { lexFortran } from '../src/fortran/lexer.mjs';

const statementValues = (lex) => lex.statements.map((s) => s.tokens.map((t) => t.value));

describe('Fortran free-form lexing', () => {
  it('splits statements on newlines and semicolons and strips ! comments', () => {
    const lex = lexFortran('x = 1; y = 2 ! set\nz = 3\n', { format: 'free' });
    assert.deepEqual(statementValues(lex), [['x', '=', '1'], ['y', '=', '2'], ['z', '=', '3']]);
    assert.deepEqual(lex.comments, [{ line: 1, text: ' set', standalone: false }]);
  });

  it('does not treat ! or & inside strings as comments or continuations', () => {
    const lex = lexFortran("msg = 'wow! & more' // \"it's\"\n", { format: 'free' });
    assert.deepEqual(statementValues(lex), [['msg', '=', 'wow! & more', '//', "it's"]]);
    assert.equal(lex.comments.length, 0);
  });

  it('joins & continuation lines, with or without a leading &', () => {
    const lex = lexFortran('call foo(a, &\n  ! comment line inside\n  & b, &\n  c)\n', { format: 'free' });
    assert.deepEqual(statementValues(lex), [['call', 'foo', '(', 'a', ',', 'b', ',', 'c', ')']]);
    assert.equal(lex.comments.length, 1);
    assert.equal(lex.comments[0].standalone, true);
  });

  it('continues a character context across lines', () => {
    const lex = lexFortran("s = 'abc&\n    &def'\n", { format: 'free' });
    assert.equal(lex.statements[0].tokens[2].value, 'abcdef');
  });

  it('reads labels, dot operators, real literals and kind suffixes', () => {
    const lex = lexFortran('10 if (a .eq. 1.e5 .and. b == 0._dp .or. c/=1.0d0) x = 1.and.y\n', { format: 'free' });
    const [statement] = lex.statements;
    assert.equal(statement.label, '10');
    const kinds = statement.tokens.map((t) => `${t.type}:${t.value}`);
    assert.ok(kinds.includes('dotop:.eq.'));
    assert.ok(kinds.includes('number:1.e5'));
    assert.ok(kinds.includes('number:0._dp'));
    assert.ok(kinds.includes('op:/='));
    assert.ok(kinds.includes('number:1.0d0'));
    assert.deepEqual(kinds.slice(-3), ['number:1', 'dotop:.and.', 'name:y']);
  });

  it('reads string kind prefixes and BOZ literals', () => {
    const lex = lexFortran("s = c_char_'hi'; i = z'ff'\n", { format: 'free' });
    const strings = lex.statements.flatMap((s) => s.tokens).filter((t) => t.type === 'string');
    assert.deepEqual(strings.map((t) => [t.prefix, t.value]), [['c_char_', 'hi'], ['z', 'ff']]);
  });

  it('skips preprocessor lines', () => {
    const lex = lexFortran('#ifdef DEBUG\nx = 1\n#endif\n', { format: 'free' });
    assert.deepEqual(statementValues(lex), [['x', '=', '1']]);
  });
});

describe('Fortran fixed-form lexing', () => {
  it('handles column-1 comments, labels and column-6 continuation', () => {
    const source = ['C     a comment', '*     another', '   10 X = A +', '     &    B', '      END'].join('\n');
    const lex = lexFortran(source, { format: 'fixed' });
    assert.deepEqual(statementValues(lex), [['X', '=', 'A', '+', 'B'], ['END']]);
    assert.equal(lex.statements[0].label, '10');
    assert.equal(lex.comments.length, 2);
  });

  it('ignores columns 73+ and keeps original columns', () => {
    const lex = lexFortran(`      X = 1${' '.repeat(61)}SEQ00010\n`, { format: 'fixed' });
    assert.deepEqual(statementValues(lex), [['X', '=', '1']]);
    assert.equal(lex.statements[0].tokens[0].col, 7);
  });

  it('continues a string from column 72 into the next line', () => {
    const lex = lexFortran("      S = 'AB\n     1CD'\n", { format: 'fixed' });
    const string = lex.statements[0].tokens[2];
    assert.equal(string.value, `AB${' '.repeat(72 - 13)}CD`);
  });

  it('supports the tab form (label TAB digit for continuation)', () => {
    const lex = lexFortran('10\tX = 1 +\n\t1 2\n', { format: 'fixed' });
    assert.deepEqual(statementValues(lex), [['X', '=', '1', '+', '2']]);
  });

  it('treats ! after column 6 as a comment', () => {
    const lex = lexFortran("      X = 1 ! note\n      Y = '!'\n", { format: 'fixed' });
    assert.deepEqual(statementValues(lex), [['X', '=', '1'], ['Y', '=', '!']]);
    assert.equal(lex.comments.length, 1);
  });
});

describe('Fortran source-form sniffing', () => {
  it('recognises fixed and free form', () => {
    assert.equal(sniffFortranFormat(['C comment', '      PROGRAM X', '      END']), 'fixed');
    assert.equal(sniffFortranFormat(['program x', '  implicit none', 'end program x']), 'free');
  });
});
