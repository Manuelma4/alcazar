/**
 * Fortran statement syntax helpers: parenthesis matching, top-level
 * splitting, type specs, declarations, program-unit headers and I/O control
 * lists. All functions work on one statement's token array.
 */

/** @typedef {import('./lexer.mjs').FortranToken} FortranToken */

/**
 * @param {FortranToken|undefined} token
 * @returns {string|null} lower-cased name, or null for non-names
 */
export function nameOf(token) {
  return token && token.type === 'name' ? token.lower : null;
}

/**
 * @param {FortranToken|undefined} token
 * @param {string} value
 */
export function isOp(token, value) {
  return token !== undefined && token.type === 'op' && token.value === value;
}

/**
 * Index of the ')' matching the '(' at `open`, or -1.
 * @param {FortranToken[]} tokens
 * @param {number} open
 * @param {number} [end]
 * @returns {number}
 */
export function matchParen(tokens, open, end = tokens.length) {
  let depth = 0;
  for (let k = open; k < end; k++) {
    const token = tokens[k];
    if (token.type !== 'op') continue;
    if (token.value === '(' || token.value === '[') depth += 1;
    else if (token.value === ')' || token.value === ']') {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/**
 * Split [start, end) at depth-0 commas.
 * @param {FortranToken[]} tokens
 * @param {number} start
 * @param {number} end
 * @returns {Array<[number, number]>}
 */
export function splitTopLevel(tokens, start, end) {
  /** @type {Array<[number, number]>} */
  const parts = [];
  let depth = 0;
  let from = start;
  for (let k = start; k < end; k++) {
    const token = tokens[k];
    if (token.type !== 'op') continue;
    if (token.value === '(' || token.value === '[') depth += 1;
    else if (token.value === ')' || token.value === ']') depth -= 1;
    else if (token.value === ',' && depth === 0) {
      parts.push([from, k]);
      from = k + 1;
    }
  }
  if (from < end) parts.push([from, end]);
  return parts;
}

/**
 * Index of the first depth-0 token satisfying `test` in [start, end), or -1.
 * @param {FortranToken[]} tokens
 * @param {number} start
 * @param {number} end
 * @param {(token: FortranToken) => boolean} test
 * @returns {number}
 */
export function findTopLevel(tokens, start, end, test) {
  let depth = 0;
  for (let k = start; k < end; k++) {
    const token = tokens[k];
    if (token.type === 'op' && (token.value === '(' || token.value === '[')) depth += 1;
    else if (token.type === 'op' && (token.value === ')' || token.value === ']')) depth -= 1;
    else if (depth === 0 && test(token)) return k;
  }
  return -1;
}

/**
 * "name = ..." or "name(...) = ..." or "name%x = ...": an assignment, even
 * when `name` happens to be a keyword (Fortran has no reserved words).
 * @param {FortranToken[]} tokens
 * @returns {boolean}
 */
export function isAssignment(tokens) {
  if (tokens.length < 2 || tokens[0].type !== 'name') return false;
  let k = 1;
  for (;;) {
    const token = tokens[k];
    if (!token) return false;
    if (isOp(token, '=') || isOp(token, '=>')) return true;
    if (isOp(token, '(')) {
      const close = matchParen(tokens, k);
      if (close === -1) return false;
      k = close + 1;
    } else if (isOp(token, '%') && tokens[k + 1]?.type === 'name') {
      k += 2;
    } else {
      return false;
    }
  }
}

const TYPE_WORDS = new Set(['integer', 'real', 'complex', 'logical', 'character', 'byte', 'double', 'doubleprecision',
  'doublecomplex', 'type', 'class']);
export const PREFIX_WORDS = new Set(['pure', 'elemental', 'recursive', 'impure', 'non_recursive', 'module', 'simple']);

/**
 * @typedef {object} TypeSpec
 * @property {string} typeName     'integer', 'real', 'double precision', 'character', 'type', ...
 * @property {FortranToken[]|null} kind   tokens inside (...) or after *
 * @property {number} next
 */

/**
 * Parse a type specification at index i.
 * @param {FortranToken[]} tokens
 * @param {number} i
 * @returns {TypeSpec|null}
 */
export function parseTypeSpec(tokens, i) {
  const word = nameOf(tokens[i]);
  if (!word || !TYPE_WORDS.has(word)) return null;
  let typeName = word;
  let k = i + 1;
  if (word === 'double') {
    const next = nameOf(tokens[k]);
    if (next !== 'precision' && next !== 'complex') return null;
    typeName = `double ${next}`;
    k += 1;
  } else if (word === 'doubleprecision') typeName = 'double precision';
  else if (word === 'doublecomplex') typeName = 'double complex';
  /** @type {FortranToken[]|null} */
  let kind = null;
  if (isOp(tokens[k], '(')) {
    const close = matchParen(tokens, k);
    if (close === -1) return null;
    kind = tokens.slice(k + 1, close);
    k = close + 1;
  } else if (isOp(tokens[k], '*')) {
    if (isOp(tokens[k + 1], '(')) {
      const close = matchParen(tokens, k + 1);
      if (close === -1) return null;
      kind = tokens.slice(k + 2, close);
      k = close + 1;
    } else if (tokens[k + 1]?.type === 'number') {
      kind = [tokens[k + 1]];
      k += 2;
    }
  }
  if ((typeName === 'type' || typeName === 'class') && kind === null) return null;
  return { typeName, kind, next: k };
}

/**
 * @typedef {object} Entity
 * @property {string} name
 * @property {FortranToken} token
 * @property {FortranToken[]|null} arraySpec
 * @property {FortranToken[]|null} init     tokens after '=' / '=>'
 */

/**
 * @typedef {object} Declaration
 * @property {string} typeName
 * @property {FortranToken[]|null} kind
 * @property {Map<string, FortranToken[]|null>} attrs  attribute name -> arguments
 * @property {Entity[]} entities
 */

/**
 * Parse a type declaration statement (INTEGER, REAL(dp), CHARACTER(LEN=*), TYPE(t), ...).
 * @param {FortranToken[]} tokens
 * @returns {Declaration|null}
 */
export function parseDeclaration(tokens) {
  const spec = parseTypeSpec(tokens, 0);
  if (!spec) return null;
  /** @type {Map<string, FortranToken[]|null>} */
  const attrs = new Map();
  let k = spec.next;
  const colons = findTopLevel(tokens, k, tokens.length, (t) => isOp(t, '::'));
  if (colons !== -1) {
    for (const [s, e] of splitTopLevel(tokens, k, colons)) {
      const attr = nameOf(tokens[s]);
      if (!attr) continue;
      const args = isOp(tokens[s + 1], '(') ? tokens.slice(s + 2, Math.max(s + 2, e - 1)) : null;
      attrs.set(attr, args);
    }
    k = colons + 1;
  } else if (isOp(tokens[k], ',')) {
    return null;
  }
  return { typeName: spec.typeName, kind: spec.kind, attrs, entities: parseEntities(tokens, k, tokens.length) };
}

/**
 * name [(array-spec)] [*len] [= init] entities.
 * @param {FortranToken[]} tokens
 * @param {number} start
 * @param {number} end
 * @returns {Entity[]}
 */
export function parseEntities(tokens, start, end) {
  /** @type {Entity[]} */
  const entities = [];
  for (const [s, e] of splitTopLevel(tokens, start, end)) {
    const token = tokens[s];
    if (!token || token.type !== 'name') continue;
    let k = s + 1;
    /** @type {FortranToken[]|null} */
    let arraySpec = null;
    while (k < e) {
      if (isOp(tokens[k], '(') && arraySpec === null) {
        const close = matchParen(tokens, k, e);
        if (close === -1) break;
        arraySpec = tokens.slice(k + 1, close);
        k = close + 1;
      } else if (isOp(tokens[k], '*')) {
        k += 1;
        if (isOp(tokens[k], '(')) {
          const close = matchParen(tokens, k, e);
          k = close === -1 ? e : close + 1;
        } else {
          k += 1;
        }
      } else {
        break;
      }
    }
    const init = isOp(tokens[k], '=') || isOp(tokens[k], '=>') ? tokens.slice(k + 1, e) : null;
    entities.push({ name: token.lower, token, arraySpec, init });
  }
  return entities;
}

/**
 * Is the last dimension of an array spec '*' (or 'lb:*')?
 * @param {FortranToken[]|null} spec
 * @returns {boolean}
 */
export function isAssumedSize(spec) {
  if (!spec || spec.length === 0) return false;
  const dims = splitTopLevel(spec, 0, spec.length);
  const [s, e] = dims[dims.length - 1];
  const last = spec.slice(s, e);
  if (last.length === 1) return isOp(last[0], '*');
  return last.length >= 3 && isOp(last[last.length - 1], '*') && isOp(last[last.length - 2], ':');
}

/**
 * @typedef {object} UnitHeader
 * @property {'program'|'module'|'submodule'|'subroutine'|'function'|'blockdata'|'separate'} kind
 * @property {string} name
 * @property {FortranToken} token     keyword token (for locations)
 * @property {string[]} args          dummy argument names
 * @property {boolean} bindC
 * @property {TypeSpec|null} resultType
 * @property {FortranToken|null} nameToken
 */

const NOT_MODULE_NAMES = new Set(['procedure', 'subroutine', 'function', ...PREFIX_WORDS, ...TYPE_WORDS]);

/**
 * Recognise a program-unit header statement.
 * @param {FortranToken[]} tokens
 * @returns {UnitHeader|null}
 */
export function parseUnitHeader(tokens) {
  const first = nameOf(tokens[0]);
  if (!first || isAssignment(tokens)) return null;
  const second = nameOf(tokens[1]);
  if (first === 'program' && second) return simpleHeader('program', tokens, 1);
  if (first === 'module' && second && !NOT_MODULE_NAMES.has(second) && tokens.length === 2) {
    return simpleHeader('module', tokens, 1);
  }
  if (first === 'module' && second === 'procedure' && tokens[2]?.type === 'name' && tokens.length === 3) {
    return { ...simpleHeader('separate', tokens, 2), token: tokens[0] };
  }
  if (first === 'submodule' && isOp(tokens[1], '(')) {
    const close = matchParen(tokens, 1);
    if (close !== -1 && tokens[close + 1]?.type === 'name') return { ...simpleHeader('submodule', tokens, close + 1), token: tokens[0] };
  }
  if (first === 'blockdata') return { ...simpleHeader('blockdata', tokens, 1), token: tokens[0] };
  if (first === 'block' && second === 'data') return { ...simpleHeader('blockdata', tokens, 2), token: tokens[0] };
  return procedureHeader(tokens);
}

/**
 * @param {UnitHeader['kind']} kind
 * @param {FortranToken[]} tokens
 * @param {number} nameIndex
 * @returns {UnitHeader}
 */
function simpleHeader(kind, tokens, nameIndex) {
  const nameToken = tokens[nameIndex]?.type === 'name' ? tokens[nameIndex] : null;
  return { kind, name: nameToken ? nameToken.lower : '', token: tokens[0], args: [], bindC: false, resultType: null, nameToken };
}

/**
 * [prefix...] [type-spec] SUBROUTINE|FUNCTION name [(args)] [RESULT(r)] [BIND(C)]
 * @param {FortranToken[]} tokens
 * @returns {UnitHeader|null}
 */
function procedureHeader(tokens) {
  let i = 0;
  /** @type {TypeSpec|null} */
  let resultType = null;
  while (i < tokens.length) {
    const word = nameOf(tokens[i]);
    if (word && PREFIX_WORDS.has(word)) {
      i += 1;
      continue;
    }
    if (!resultType) {
      const spec = parseTypeSpec(tokens, i);
      if (spec) {
        resultType = spec;
        i = spec.next;
        continue;
      }
    }
    break;
  }
  const keyword = nameOf(tokens[i]);
  if (keyword !== 'subroutine' && keyword !== 'function') return null;
  const nameToken = tokens[i + 1];
  if (!nameToken || nameToken.type !== 'name') return null;
  if (tokens[i + 2] && !isOp(tokens[i + 2], '(') && nameOf(tokens[i + 2]) !== 'bind' && nameOf(tokens[i + 2]) !== 'result') {
    return null;
  }
  /** @type {string[]} */
  const args = [];
  let k = i + 2;
  if (isOp(tokens[k], '(')) {
    const close = matchParen(tokens, k);
    if (close === -1) return null;
    for (const [s, e] of splitTopLevel(tokens, k + 1, close)) if (e - s === 1 && tokens[s].type === 'name') args.push(tokens[s].lower);
    k = close + 1;
  }
  let bindC = false;
  for (; k < tokens.length; k++) {
    if (nameOf(tokens[k]) === 'bind' && isOp(tokens[k + 1], '(') && nameOf(tokens[k + 2]) === 'c') bindC = true;
  }
  return { kind: keyword, name: nameToken.lower, token: tokens[i], args, bindC, resultType, nameToken };
}

/**
 * @typedef {object} ControlItem
 * @property {string|null} keyword lower-cased keyword (unit, fmt, iostat ...) or null when positional
 * @property {FortranToken[]} value
 */

/**
 * Items of an I/O control list "( ... )" starting at `open`.
 * @param {FortranToken[]} tokens
 * @param {number} open
 * @returns {{ items: ControlItem[], close: number } | null}
 */
export function controlList(tokens, open) {
  if (!isOp(tokens[open], '(')) return null;
  const close = matchParen(tokens, open);
  if (close === -1) return null;
  /** @type {ControlItem[]} */
  const items = [];
  for (const [s, e] of splitTopLevel(tokens, open + 1, close)) {
    if (tokens[s]?.type === 'name' && isOp(tokens[s + 1], '=') && e > s + 1) {
      items.push({ keyword: tokens[s].lower, value: tokens.slice(s + 2, e) });
    } else {
      items.push({ keyword: null, value: tokens.slice(s, e) });
    }
  }
  return { items, close };
}
