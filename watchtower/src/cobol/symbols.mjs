/**
 * DATA DIVISION symbol table: level hierarchy, PICTURE / USAGE typing,
 * VALUE, OCCURS, REDEFINES, 88-level conditions, FD/SD names and optional
 * textual COPY resolution (for typing only; findings never point into a
 * copybook from the including file).
 */
import { lexCobol } from './lexer.mjs';
import { parsePicture } from './pic.mjs';
import { divisionRanges, isLevelNumber, rangesOf, sentenceEnd } from './structure.mjs';

/** @typedef {import('./lexer.mjs').CobolToken} CobolToken */
/** @typedef {import('./pic.mjs').PicInfo} PicInfo */

/**
 * @typedef {object} DataValue
 * @property {'string'|'number'|'figurative'|'all'} kind
 * @property {string} text    literal content or figurative constant name
 * @property {CobolToken} token
 */

/**
 * @typedef {object} DataItem
 * @property {string} name            upper case, 'FILLER' when anonymous
 * @property {number} level
 * @property {DataItem|null} parent
 * @property {DataItem[]} children
 * @property {Condition[]} conditions 88-level entries under this item
 * @property {string|null} picture    PICTURE text as written
 * @property {PicInfo|null} pic
 * @property {string} usage           'display', 'comp', 'comp-3', 'comp-5', 'binary', 'comp-1', ...
 * @property {'alphanumeric'|'alphabetic'|'numeric'|'numeric-edited'|'national'|'group'|null} category
 * @property {boolean} signed
 * @property {number|null} intDigits
 * @property {number|null} decDigits
 * @property {number|null} length
 * @property {boolean} float          binary floating point usage
 * @property {number} occurs          1 when not a table
 * @property {string|null} redefines
 * @property {DataValue|null} value
 * @property {CobolToken} token       name token (level token when anonymous)
 * @property {CobolToken|null} usageToken
 * @property {boolean} fromCopybook
 * @property {string|null} [nativeWord] BINARY-CHAR / -SHORT / -LONG / -DOUBLE
 */

/**
 * @typedef {object} Condition
 * @property {string} name
 * @property {DataItem} item
 * @property {string[]} values   literal values (THRU ranges contribute both ends)
 * @property {CobolToken} token
 */

/**
 * @typedef {object} SymbolTable
 * @property {DataItem[]} items
 * @property {Map<string, DataItem[]>} byName
 * @property {Map<string, Condition[]>} conditions
 * @property {Map<string, 'FD'|'SD'|'RD'|'CD'>} files  file descriptions by file name
 * @property {(ref: { name: string, qualifiers?: string[] }) => DataItem|null} resolve
 */

/**
 * @typedef {object} CopybookOptions
 * @property {(name: string) => (string|null|undefined)} [resolveCopybook]
 */

const USAGES = new Map([
  ['DISPLAY', 'display'], ['NATIONAL', 'display'],
  ['COMP', 'comp'], ['COMPUTATIONAL', 'comp'], ['COMP-4', 'comp'], ['COMPUTATIONAL-4', 'comp'],
  ['BINARY', 'binary'],
  ['COMP-3', 'comp-3'], ['COMPUTATIONAL-3', 'comp-3'], ['COMP-6', 'comp-3'], ['COMPUTATIONAL-6', 'comp-3'],
  ['PACKED-DECIMAL', 'packed-decimal'],
  ['COMP-5', 'comp-5'], ['COMPUTATIONAL-5', 'comp-5'], ['COMP-X', 'comp-5'], ['COMPUTATIONAL-X', 'comp-5'],
  ['COMP-N', 'comp-5'], ['COMPUTATIONAL-N', 'comp-5'],
  ['COMP-1', 'comp-1'], ['COMPUTATIONAL-1', 'comp-1'], ['COMP-2', 'comp-2'], ['COMPUTATIONAL-2', 'comp-2'],
  ['FLOAT-SHORT', 'float-short'], ['FLOAT-LONG', 'float-long'], ['FLOAT-EXTENDED', 'float-extended'],
  ['FLOAT-BINARY-32', 'float-short'], ['FLOAT-BINARY-64', 'float-long'], ['FLOAT-BINARY-128', 'float-extended'],
  ['FLOAT-DECIMAL-16', 'float-decimal'], ['FLOAT-DECIMAL-34', 'float-decimal'],
  ['INDEX', 'index'], ['POINTER', 'pointer'], ['PROGRAM-POINTER', 'pointer'], ['PROCEDURE-POINTER', 'pointer'],
  ['FUNCTION-POINTER', 'pointer'],
  ['BINARY-CHAR', 'comp-5'], ['BINARY-SHORT', 'comp-5'], ['BINARY-LONG', 'comp-5'], ['BINARY-DOUBLE', 'comp-5'],
  ['BINARY-C-LONG', 'comp-5'],
]);

/** Implied digit capacity of the native binary usages (no PICTURE). */
const NATIVE_DIGITS = new Map([
  ['BINARY-CHAR', 3], ['BINARY-SHORT', 5], ['BINARY-LONG', 10], ['BINARY-DOUBLE', 19], ['BINARY-C-LONG', 19],
]);

export const FLOAT_USAGES = new Set(['comp-1', 'comp-2', 'float-short', 'float-long', 'float-extended']);

/** Figurative constants (singular and plural spellings). */
export const FIGURATIVES = new Set([
  'ZERO', 'ZEROS', 'ZEROES', 'SPACE', 'SPACES', 'HIGH-VALUE', 'HIGH-VALUES', 'LOW-VALUE', 'LOW-VALUES',
  'QUOTE', 'QUOTES', 'NULL', 'NULLS',
]);

/** Words that start a clause, so they are never data names. */
const CLAUSE_WORDS = new Set([
  'PIC', 'PICTURE', 'USAGE', 'VALUE', 'VALUES', 'OCCURS', 'REDEFINES', 'RENAMES', 'SIGN', 'JUST', 'JUSTIFIED',
  'BLANK', 'SYNC', 'SYNCHRONIZED', 'EXTERNAL', 'GLOBAL', 'BASED', 'FILLER', 'IS', ...USAGES.keys(),
]);

const MAX_COPY_DEPTH = 5;
const MAX_COPYBOOKS = 100;
const MAX_COPY_CHARS = 4 * 1024 * 1024;

/**
 * Build the symbol table from the DATA DIVISION of a lexed program.
 * @param {CobolToken[]} tokens
 * @param {import('./structure.mjs').DivisionRange[]} ranges
 * @param {CopybookOptions} [options]
 * @returns {SymbolTable}
 */
export function buildSymbolTable(tokens, ranges, options = {}) {
  const builder = new SymbolBuilder(options);
  for (const range of rangesOf(ranges, 'DATA')) builder.sentences(tokens, range.start, range.end, false);
  return builder.finish();
}

class SymbolBuilder {
  /** @param {CopybookOptions} options */
  constructor(options) {
    this.options = options;
    /** @type {DataItem[]} */
    this.items = [];
    /** @type {DataItem[]} */
    this.stack = [];
    /** @type {Map<string, 'FD'|'SD'|'RD'|'CD'>} */
    this.files = new Map();
    /** @type {string[]} */
    this.copyChain = [];
    this.copyCount = 0;
    this.copyChars = 0;
  }

  /**
   * @param {CobolToken[]} tokens
   * @param {number} start
   * @param {number} end
   * @param {boolean} fromCopybook
   */
  sentences(tokens, start, end, fromCopybook) {
    let i = start;
    while (i < end) {
      const stop = sentenceEnd(tokens, i, end);
      this.sentence(tokens, i, stop, fromCopybook);
      i = stop + 1;
    }
  }

  /**
   * @param {CobolToken[]} tokens
   * @param {number} start
   * @param {number} end exclusive (the period)
   * @param {boolean} fromCopybook
   */
  sentence(tokens, start, end, fromCopybook) {
    if (start >= end) return;
    const first = tokens[start];
    if (first.type === 'word' && (first.upper === 'FD' || first.upper === 'SD' || first.upper === 'RD' || first.upper === 'CD')) {
      const name = tokens[start + 1];
      if (name && name.type === 'word') this.files.set(name.upper, /** @type {'FD'} */ (first.upper));
      this.stack = [];
      return;
    }
    if (first.type === 'word' && first.upper === 'COPY') {
      this.copy(tokens, start, end);
      return;
    }
    if (first.type === 'word' && tokens[start + 1]?.upper === 'SECTION') {
      this.stack = [];
      return;
    }
    if (isLevelNumber(first)) this.entry(tokens, start, end, fromCopybook);
  }

  /**
   * COPY name [OF|IN library] [SUPPRESS] [REPLACING ...]. Copybooks used with
   * REPLACING are skipped: their names cannot be known without the replacement.
   * @param {CobolToken[]} tokens
   * @param {number} start
   * @param {number} end
   */
  copy(tokens, start, end) {
    const resolve = this.options.resolveCopybook;
    const nameToken = tokens[start + 1];
    if (!resolve || !nameToken || (nameToken.type !== 'word' && nameToken.type !== 'string')) return;
    for (let k = start + 2; k < end; k++) if (tokens[k].upper === 'REPLACING') return;
    const name = nameToken.value;
    const key = name.toUpperCase();
    if (this.copyChain.includes(key) || this.copyChain.length >= MAX_COPY_DEPTH) return;
    if (this.copyCount >= MAX_COPYBOOKS) return;
    let text;
    try {
      text = resolve(name);
    } catch {
      return;
    }
    if (typeof text !== 'string' || this.copyChars + text.length > MAX_COPY_CHARS) return;
    this.copyCount += 1;
    this.copyChars += text.length;
    const lex = lexCobol(text);
    this.copyChain.push(key);
    for (const range of divisionRanges(lex.tokens)) {
      if (range.name === 'DATA') this.sentences(lex.tokens, range.start, range.end, true);
    }
    this.copyChain.pop();
  }

  /**
   * @param {CobolToken[]} tokens
   * @param {number} start
   * @param {number} end
   * @param {boolean} fromCopybook
   */
  entry(tokens, start, end, fromCopybook) {
    const level = Number(tokens[start].value);
    if (level === 66) return;
    let k = start + 1;
    let name = 'FILLER';
    let nameToken = tokens[start];
    const candidate = tokens[k];
    if (k < end && candidate.type === 'word' && !CLAUSE_WORDS.has(candidate.upper)) {
      name = candidate.upper;
      nameToken = candidate;
      k += 1;
    } else if (k < end && candidate.upper === 'FILLER') {
      nameToken = candidate;
      k += 1;
    }
    if (level === 88) {
      this.condition(tokens, k, end, name, nameToken);
      return;
    }
    /** @type {DataItem} */
    const item = {
      name, level, parent: null, children: [], conditions: [], picture: null, pic: null, usage: 'display',
      category: null, signed: false, intDigits: null, decDigits: null, length: null, float: false, occurs: 1,
      redefines: null, value: null, token: nameToken, usageToken: null, fromCopybook,
    };
    const clauses = parseClauses(tokens, k, end);
    Object.assign(item, clauses.item);
    item.usageToken = clauses.usageToken;
    item.nativeWord = clauses.nativeWord;
    this.place(item);
    this.items.push(item);
  }

  /** @param {DataItem} item */
  place(item) {
    if (item.level === 1 || item.level === 77) {
      this.stack = item.level === 1 ? [item] : [];
      return;
    }
    while (this.stack.length > 0 && this.stack[this.stack.length - 1].level >= item.level) this.stack.pop();
    const parent = this.stack[this.stack.length - 1] ?? null;
    if (parent) {
      item.parent = parent;
      parent.children.push(item);
    }
    this.stack.push(item);
  }

  /**
   * @param {CobolToken[]} tokens
   * @param {number} k
   * @param {number} end
   * @param {string} name
   * @param {CobolToken} token
   */
  condition(tokens, k, end, name, token) {
    const owner = this.items[this.items.length - 1];
    if (!owner) return;
    const values = [];
    for (let j = k; j < end; j++) {
      const t = tokens[j];
      if (t.type === 'string' || t.type === 'number') values.push(t.value);
      else if (t.type === 'word' && FIGURATIVES.has(t.upper)) values.push(t.upper);
    }
    owner.conditions.push({ name, item: owner, values, token });
  }

  /** @returns {SymbolTable} */
  finish() {
    for (const item of this.items) finalizeCategory(item);
    for (const item of this.items) if (item.category === 'group') item.length = groupLength(item, 0);
    /** @type {Map<string, DataItem[]>} */
    const byName = new Map();
    /** @type {Map<string, Condition[]>} */
    const conditions = new Map();
    for (const item of this.items) {
      if (item.name !== 'FILLER') pushTo(byName, item.name, item);
      for (const condition of item.conditions) pushTo(conditions, condition.name, condition);
    }
    return {
      items: this.items,
      byName,
      conditions,
      files: this.files,
      resolve: (ref) => resolveItem(byName, ref),
    };
  }
}

/**
 * @template T
 * @param {Map<string, T[]>} map
 * @param {string} key
 * @param {T} value
 */
function pushTo(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Parse the clauses of a data description entry.
 * @param {CobolToken[]} tokens
 * @param {number} k
 * @param {number} end
 */
function parseClauses(tokens, k, end) {
  /** @type {Partial<DataItem>} */
  const item = {};
  /** @type {CobolToken|null} */
  let usageToken = null;
  /** @type {string|null} */
  let nativeWord = null;
  let signSeparate = false;
  let unsigned = false;
  while (k < end) {
    const t = tokens[k];
    const u = t.upper;
    if (t.type === 'pic') {
      item.picture = t.value;
      item.pic = parsePicture(t.value);
      k += 1;
    } else if (u === 'REDEFINES') {
      item.redefines = tokens[k + 1]?.upper ?? null;
      k += 2;
    } else if (u === 'USAGE') {
      k += 1;
      if (tokens[k]?.upper === 'IS') k += 1;
    } else if (t.type === 'word' && USAGES.has(u)) {
      item.usage = /** @type {string} */ (USAGES.get(u));
      usageToken = t;
      if (NATIVE_DIGITS.has(u)) nativeWord = u;
      k += 1;
    } else if (u === 'UNSIGNED') {
      unsigned = true;
      k += 1;
    } else if ((u === 'VALUE' || u === 'VALUES') && t.type === 'word') {
      k += 1;
      while (k < end && (tokens[k].upper === 'IS' || tokens[k].upper === 'ARE')) k += 1;
      const parsed = parseValue(tokens, k, end);
      if (parsed) item.value = parsed;
      k += 1;
    } else if (u === 'OCCURS') {
      const { occurs, next } = parseOccurs(tokens, k + 1, end);
      item.occurs = occurs;
      k = next;
    } else if (u === 'SEPARATE') {
      signSeparate = true;
      k += 1;
    } else {
      k += 1;
    }
  }
  if (nativeWord) {
    item.intDigits = NATIVE_DIGITS.get(nativeWord) ?? null;
    item.decDigits = 0;
    item.signed = !unsigned;
  }
  if (signSeparate && item.pic) item.pic = { ...item.pic, length: item.pic.length + 1 };
  return { item, usageToken, nativeWord };
}

/**
 * @param {CobolToken[]} tokens
 * @param {number} k
 * @param {number} end
 * @returns {DataValue|null}
 */
function parseValue(tokens, k, end) {
  const t = tokens[k];
  if (!t || k >= end) return null;
  if (t.type === 'string') return { kind: 'string', text: t.value, token: t };
  if (t.type === 'number') return { kind: 'number', text: t.value, token: t };
  if (t.type === 'word' && FIGURATIVES.has(t.upper)) return { kind: 'figurative', text: t.upper, token: t };
  if (t.type === 'word' && t.upper === 'ALL') {
    const next = tokens[k + 1];
    return { kind: 'all', text: next ? next.value : '', token: t };
  }
  return null;
}

/**
 * OCCURS n [TIMES] | OCCURS n TO m [TIMES] DEPENDING ON x.
 * @param {CobolToken[]} tokens
 * @param {number} k
 * @param {number} end
 * @returns {{ occurs: number, next: number }}
 */
function parseOccurs(tokens, k, end) {
  let occurs = 1;
  if (k < end && tokens[k].type === 'number') {
    occurs = Number(tokens[k].value) || 1;
    k += 1;
    if (k + 1 < end && tokens[k].upper === 'TO' && tokens[k + 1].type === 'number') {
      occurs = Number(tokens[k + 1].value) || occurs;
      k += 2;
    }
  }
  return { occurs, next: k };
}

/** @param {DataItem} item */
function finalizeCategory(item) {
  if (item.children.length > 0) {
    item.category = 'group';
    return;
  }
  item.float = FLOAT_USAGES.has(item.usage);
  if (item.pic) {
    item.category = item.float ? 'numeric' : item.pic.category;
    item.signed = item.pic.signed;
    item.intDigits = item.float ? null : item.pic.intDigits;
    item.decDigits = item.float ? null : item.pic.decDigits;
    item.length = item.pic.length;
    return;
  }
  if (item.float) {
    item.category = 'numeric';
    item.signed = true;
    return;
  }
  if (item.nativeWord) {
    item.category = 'numeric';
    return;
  }
  if (item.usage === 'index' || item.usage === 'pointer') return;
  item.category = 'group';
}

/**
 * Length of a group from its children (null when unknown).
 * @param {DataItem} item
 * @param {number} depth
 * @returns {number|null}
 */
function groupLength(item, depth) {
  if (depth > 60 || item.children.length === 0) return null;
  let total = 0;
  for (const child of item.children) {
    if (child.redefines) continue;
    const length = child.category === 'group' ? groupLength(child, depth + 1) : child.length;
    if (length === null) return null;
    total += length * child.occurs;
  }
  return total;
}

/**
 * Resolve a (possibly qualified) data name. Ambiguous names resolve to null.
 * @param {Map<string, DataItem[]>} byName
 * @param {{ name: string, qualifiers?: string[] }} ref
 * @returns {DataItem|null}
 */
function resolveItem(byName, ref) {
  const candidates = byName.get(ref.name) ?? [];
  const qualifiers = ref.qualifiers ?? [];
  const matches = qualifiers.length === 0
    ? candidates
    : candidates.filter((item) => isQualifiedBy(item, qualifiers));
  return matches.length === 1 ? matches[0] : null;
}

/**
 * @param {DataItem} item
 * @param {string[]} qualifiers innermost first
 * @returns {boolean}
 */
function isQualifiedBy(item, qualifiers) {
  let node = item.parent;
  for (const qualifier of qualifiers) {
    while (node && node.name !== qualifier) node = node.parent;
    if (!node) return false;
    node = node.parent;
  }
  return true;
}
