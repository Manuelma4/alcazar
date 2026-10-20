import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lexCobol } from '../src/cobol/lexer.mjs';
import { parsePicture } from '../src/cobol/pic.mjs';
import { divisionRanges } from '../src/cobol/structure.mjs';
import { buildSymbolTable } from '../src/cobol/symbols.mjs';
import { fixed } from './helpers.mjs';

/**
 * @param {string[]} dataLines
 * @param {object} [options]
 */
function table(dataLines, options = {}) {
  const lex = lexCobol(fixed(['DATA DIVISION.', 'WORKING-STORAGE SECTION.', ...dataLines]), { format: 'fixed' });
  return buildSymbolTable(lex.tokens, divisionRanges(lex.tokens), options);
}

describe('PICTURE parsing', () => {
  const cases = [
    ['9(5)', { category: 'numeric', signed: false, intDigits: 5, decDigits: 0, length: 5 }],
    ['S9(7)V99', { category: 'numeric', signed: true, intDigits: 7, decDigits: 2, length: 9 }],
    ['s9(3)v9(4)', { category: 'numeric', signed: true, intDigits: 3, decDigits: 4, length: 7 }],
    ['V9999', { category: 'numeric', signed: false, intDigits: 0, decDigits: 4, length: 4 }],
    ['999PPP', { category: 'numeric', signed: false, intDigits: 6, decDigits: 0, length: 3 }],
    ['PP99', { category: 'numeric', signed: false, intDigits: 0, decDigits: 4, length: 2 }],
    ['X(10)', { category: 'alphanumeric', signed: false, intDigits: 0, decDigits: 0, length: 10 }],
    ['XXX', { category: 'alphanumeric', signed: false, intDigits: 0, decDigits: 0, length: 3 }],
    ['A(4)', { category: 'alphabetic', signed: false, intDigits: 0, decDigits: 0, length: 4 }],
    ['N(5)', { category: 'national', signed: false, intDigits: 0, decDigits: 0, length: 5 }],
    ['ZZ,ZZ9.99', { category: 'numeric-edited', signed: false, intDigits: 5, decDigits: 2, length: 9 }],
    ['$$,$$9.99', { category: 'numeric-edited', signed: false, intDigits: 4, decDigits: 2, length: 9 }],
    ['-(9)9.99', { category: 'numeric-edited', signed: true, intDigits: 9, decDigits: 2, length: 13 }],
    ['ZZZ9.99CR', { category: 'numeric-edited', signed: true, intDigits: 4, decDigits: 2, length: 9 }],
    ['***,**9.99', { category: 'numeric-edited', signed: false, intDigits: 6, decDigits: 2, length: 10 }],
    ['99/99/9999', { category: 'numeric-edited', signed: false, intDigits: 8, decDigits: 0, length: 10 }],
    ['XXBXX', { category: 'alphanumeric', signed: false, intDigits: 0, decDigits: 0, length: 5 }],
  ];
  for (const [pic, expected] of cases) {
    it(`parses ${pic}`, () => assert.deepEqual(parsePicture(pic), expected));
  }

  it('rejects invalid pictures and absurd repetition counts', () => {
    assert.equal(parsePicture('9('), null);
    assert.equal(parsePicture('9()'), null);
    assert.equal(parsePicture('X(99999999999)'), null);
    assert.equal(parsePicture('Q9'), null);
    assert.equal(parsePicture(''), null);
  });
});

describe('DATA DIVISION symbol table', () => {
  it('types elementary items from PICTURE and USAGE', () => {
    const t = table([
      '01  WS-AMT        PIC S9(9)V99 COMP-3.',
      '01  WS-RATE       USAGE IS COMP-2.',
      '01  WS-NAME       PIC X(30) VALUE "ACME".',
      '01  WS-COUNT      BINARY-LONG UNSIGNED.',
      '77  WS-FLAG       PIC X VALUE SPACE.',
    ]);
    const amt = t.resolve({ name: 'WS-AMT' });
    assert.equal(amt.category, 'numeric');
    assert.equal(amt.usage, 'comp-3');
    assert.equal(amt.signed, true);
    assert.equal(amt.intDigits, 9);
    assert.equal(amt.decDigits, 2);
    const rate = t.resolve({ name: 'WS-RATE' });
    assert.equal(rate.usage, 'comp-2');
    assert.equal(rate.float, true);
    assert.deepEqual(t.resolve({ name: 'WS-NAME' }).value.text, 'ACME');
    const count = t.resolve({ name: 'WS-COUNT' });
    assert.equal(count.category, 'numeric');
    assert.equal(count.intDigits, 10);
    assert.equal(count.signed, false);
    assert.equal(t.resolve({ name: 'WS-FLAG' }).value.kind, 'figurative');
  });

  it('builds the level hierarchy, group lengths, OCCURS and REDEFINES', () => {
    const t = table([
      '01  CUSTOMER.',
      '    05  CUST-ID       PIC X(10).',
      '    05  CUST-NAME.',
      '        10  FIRST-NAME PIC X(15).',
      '        10  LAST-NAME  PIC X(20).',
      '    05  CUST-PHONES   PIC X(12) OCCURS 3 TIMES.',
      '    05  CUST-ALT REDEFINES CUST-PHONES PIC X(36).',
    ]);
    const customer = t.resolve({ name: 'CUSTOMER' });
    assert.equal(customer.category, 'group');
    assert.equal(customer.length, 10 + 35 + 36);
    const last = t.resolve({ name: 'LAST-NAME' });
    assert.equal(last.parent.name, 'CUST-NAME');
    assert.equal(last.parent.parent.name, 'CUSTOMER');
    assert.equal(t.resolve({ name: 'CUST-PHONES' }).occurs, 3);
    assert.equal(t.resolve({ name: 'CUST-ALT' }).redefines, 'CUST-PHONES');
  });

  it('treats duplicate names as unknown unless qualified', () => {
    const t = table([
      '01  IN-REC.',
      '    05  AMT  PIC 9(5).',
      '01  OUT-REC.',
      '    05  AMT  PIC 9(7).',
    ]);
    assert.equal(t.resolve({ name: 'AMT' }), null);
    assert.equal(t.resolve({ name: 'AMT', qualifiers: ['OUT-REC'] }).intDigits, 7);
    assert.equal(t.resolve({ name: 'AMT', qualifiers: ['NOPE'] }), null);
  });

  it('collects 88-level condition values and skips 66 levels', () => {
    const t = table([
      '01  WS-FS PIC XX.',
      '    88  FS-OK VALUE "00".',
      '    88  FS-LENGTH VALUES ARE "04" "06".',
      '66  WS-ALIAS RENAMES WS-FS.',
    ]);
    const fs = t.resolve({ name: 'WS-FS' });
    assert.deepEqual(fs.conditions.map((c) => [c.name, c.values]), [['FS-OK', ['00']], ['FS-LENGTH', ['04', '06']]]);
    assert.equal(t.resolve({ name: 'WS-ALIAS' }), null);
  });

  it('records FD and SD file names', () => {
    const lex = lexCobol(fixed(['DATA DIVISION.', 'FILE SECTION.', 'FD  IN-FILE.', '01  IN-REC PIC X(80).', 'SD  SORT-WORK.', '01  SORT-REC PIC X(80).']), { format: 'fixed' });
    const t = buildSymbolTable(lex.tokens, divisionRanges(lex.tokens));
    assert.equal(t.files.get('IN-FILE'), 'FD');
    assert.equal(t.files.get('SORT-WORK'), 'SD');
  });

  it('resolves COPY members for typing, with a recursion guard', () => {
    const books = {
      CUSTREC: fixed(['    05  CUST-BAL PIC S9(7)V99.', '    COPY NESTED.']),
      NESTED: fixed(['    05  CUST-LIMIT PIC 9(5).', '    COPY CUSTREC.']),
    };
    const requested = [];
    const t = table(['01  CUSTOMER.', '    COPY CUSTREC.'], {
      resolveCopybook: (name) => {
        requested.push(name);
        return books[name] ?? null;
      },
    });
    assert.equal(t.resolve({ name: 'CUST-BAL' }).parent.name, 'CUSTOMER');
    assert.equal(t.resolve({ name: 'CUST-LIMIT' }).intDigits, 5);
    assert.ok(t.resolve({ name: 'CUST-BAL' }).fromCopybook);
    assert.deepEqual(requested, ['CUSTREC', 'NESTED']);
  });

  it('skips COPY ... REPLACING, whose names cannot be known', () => {
    const t = table(['01  CUSTOMER.', '    COPY CUSTREC REPLACING ==:P:== BY ==WS==.'], {
      resolveCopybook: () => fixed(['    05  :P:-BAL PIC 9(5).']),
    });
    assert.equal(t.items.length, 1);
  });
});
