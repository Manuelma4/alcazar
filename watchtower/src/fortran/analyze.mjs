/**
 * Fortran analysis: program-unit tracking (host association, interface
 * bodies, derived types), declarations, and the statement-level rules.
 */
import { FindingSink } from '../finding.mjs';
import {
  isFortranCredentialName, isFortranMonetaryName, isSecretContextWord,
} from '../names.mjs';
import { escapeInvisible, isAsciiLetterCode, isDigitCode } from '../text.mjs';
import { checkComparisons, checkShortCircuit, isRealLiteral } from './expressions.mjs';
import { lexFortran } from './lexer.mjs';
import {
  controlList, isAssignment, isAssumedSize, isOp, matchParen, nameOf, parseDeclaration, parseEntities,
  parseUnitHeader, splitTopLevel,
} from './syntax.mjs';

/** @typedef {import('./lexer.mjs').FortranToken} FortranToken */
/** @typedef {import('./syntax.mjs').UnitHeader} UnitHeader */

/**
 * @typedef {object} Decl
 * @property {string|null} typeName
 * @property {boolean} isArray
 * @property {boolean} isParameter
 */

/**
 * @typedef {object} Unit
 * @property {UnitHeader['kind']} kind
 * @property {string} name
 * @property {FortranToken} token
 * @property {boolean} hasImplicitNone
 * @property {boolean} isInterfaceBody
 * @property {boolean} hosted         module / internal procedure (inherits implicit typing)
 * @property {Unit|null} parent       host scope
 * @property {boolean} bindC
 * @property {Set<string>} dummies
 * @property {Map<string, Decl>} decls
 * @property {string|null} secretWord first secret-context word seen (rule 012)
 * @property {FortranToken[]} randomUses
 */

const UNIT_END_WORDS = new Set(['program', 'module', 'submodule', 'subroutine', 'function', 'procedure', 'blockdata']);
const CONSOLE_UNITS = new Set(['output_unit', 'error_unit', 'stdout', 'stderr']);
const IO_VERBS = new Set(['open', 'read', 'write', 'close', 'inquire']);
const SINGLE_KINDS = new Set(['4', 'sp', 'real32', 'c_float', 'r4', 'single', 'rsp']);

/**
 * @param {string} source
 * @param {{ format?: 'free'|'fixed'|null }} [options]
 * @returns {import('../cobol/index.mjs').LanguageAnalysis}
 */
export function analyzeFortran(source, options = {}) {
  const lex = lexFortran(source, { format: options.format });
  const sink = new FindingSink(lex.lines);
  const analyzer = new FortranAnalyzer(sink);
  for (const statement of lex.statements) analyzer.statement(statement.tokens);
  analyzer.finish();
  const identifiers = [];
  for (const statement of lex.statements) {
    for (const token of statement.tokens) if (token.type === 'name') identifiers.push(token);
  }
  return {
    format: lex.format, lines: lex.lines, sink, comments: lex.comments, codeLines: lex.codeLines, identifiers,
  };
}

class FortranAnalyzer {
  /** @param {FindingSink} sink */
  constructor(sink) {
    this.sink = sink;
    /** @type {Unit[]} */
    this.units = [];
    /** @type {Unit[]} */
    this.stack = [];
    this.interfaceDepth = 0;
    this.typeDepth = 0;
  }

  /** @returns {Unit|null} */
  get current() {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** @param {FortranToken[]} raw */
  statement(raw) {
    const tokens = stripConstructName(raw);
    if (tokens.length === 0) return;
    const header = this.typeDepth === 0 ? parseUnitHeader(tokens) : null;
    if (header && !(header.kind === 'separate' && this.interfaceDepth > 0)) {
      this.openUnit(header, tokens);
      return;
    }
    if (this.endStatement(tokens)) return;
    if (!this.current) this.openImplicitProgram(tokens);
    const unit = /** @type {Unit} */ (this.current);
    this.recordMentions(unit, tokens);
    const assignment = isAssignment(tokens);
    if (!assignment && this.structural(unit, tokens)) return;
    if (this.interfaceDepth > 0) return;
    this.analyze(unit, tokens, assignment);
  }

  /**
   * INTERFACE, TYPE definitions, CONTAINS and IMPLICIT.
   * @param {Unit} unit
   * @param {FortranToken[]} tokens
   * @returns {boolean} true when the statement was consumed
   */
  structural(unit, tokens) {
    const first = nameOf(tokens[0]);
    if (first === 'interface' || (first === 'abstract' && nameOf(tokens[1]) === 'interface')) {
      this.interfaceDepth += 1;
      return true;
    }
    if (first === 'type' && isTypeDefinition(tokens)) {
      this.typeDepth += 1;
      return true;
    }
    if (this.typeDepth > 0) {
      const decl = parseDeclaration(tokens);
      if (decl) this.declarationChecks(decl);
      return true;
    }
    if (first === 'contains') return true;
    if (first === 'implicit' || first === 'implicitnone') {
      if (isImplicitNone(tokens)) unit.hasImplicitNone = true;
      return true;
    }
    return false;
  }

  /**
   * @param {UnitHeader} header
   * @param {FortranToken[]} tokens
   */
  openUnit(header, tokens) {
    const parent = this.current;
    const isInterfaceBody = this.interfaceDepth > 0;
    /** @type {Unit} */
    const unit = {
      kind: header.kind,
      name: header.name,
      token: header.nameToken ?? header.token,
      hasImplicitNone: false,
      isInterfaceBody,
      hosted: parent !== null && !isInterfaceBody,
      parent: isInterfaceBody ? null : parent,
      bindC: header.bindC,
      dummies: new Set(header.args),
      decls: new Map(),
      secretWord: null,
      randomUses: [],
    };
    this.units.push(unit);
    this.stack.push(unit);
    this.recordMentions(unit, tokens);
    const result = header.resultType;
    if (!isInterfaceBody && header.kind === 'function' && result && result.typeName === 'real'
      && isSinglePrecision(result.kind) && header.nameToken && isFortranMonetaryName(header.name)) {
      this.sink.addAt('ALZ-FOR-010', header.nameToken,
        `Function ${escapeInvisible(header.nameToken.value)} returns money as single-precision REAL (about 7 significant digits): cents are lost. Return integer cents or real(real64).`);
    }
  }

  /** @param {FortranToken[]} tokens */
  openImplicitProgram(tokens) {
    this.openUnit({
      kind: 'program', name: '', token: tokens[0], args: [], bindC: false, resultType: null, nameToken: null,
    }, []);
  }

  /**
   * END [PROGRAM|MODULE|...], END INTERFACE, END TYPE.
   * @param {FortranToken[]} tokens
   * @returns {boolean}
   */
  endStatement(tokens) {
    const first = nameOf(tokens[0]);
    if (!first || !first.startsWith('end') || isAssignment(tokens)) return false;
    let what = first === 'end' ? (nameOf(tokens[1]) ?? '') : first.slice(3);
    if (first === 'end' && what === 'block' && nameOf(tokens[2]) === 'data') what = 'blockdata';
    if (what === 'interface') {
      this.interfaceDepth = Math.max(0, this.interfaceDepth - 1);
      return true;
    }
    if (what === 'type') {
      this.typeDepth = Math.max(0, this.typeDepth - 1);
      return true;
    }
    if (what === '' || UNIT_END_WORDS.has(what)) {
      if (this.typeDepth > 0) return false;
      this.closeUnit();
      return true;
    }
    return false;
  }

  closeUnit() {
    const unit = this.stack.pop();
    if (!unit || unit.isInterfaceBody || unit.hosted || unit.hasImplicitNone) return;
    const what = unit.kind === 'blockdata' ? 'BLOCK DATA' : unit.kind === 'separate' ? 'procedure' : unit.kind;
    const name = unit.name ? ` ${escapeInvisible(unit.token.value)}` : ' (main program)';
    this.sink.addAt('ALZ-FOR-001', unit.token,
      `${capitalize(what)}${name} has no IMPLICIT NONE: undeclared names are silently typed (I-N INTEGER, others REAL), so a typo creates a new variable.`);
  }

  finish() {
    while (this.stack.length > 0) this.closeUnit();
    for (const unit of this.units) {
      if (unit.randomUses.length === 0) continue;
      const word = secretContext(unit);
      if (!word) continue;
      for (const use of unit.randomUses) {
        this.sink.addAt('ALZ-FOR-012', use,
          `${escapeInvisible(use.value)} is a statistical PRNG, but this procedure handles "${escapeInvisible(word)}": values derived from it are predictable. Use the operating-system CSPRNG.`);
      }
    }
  }

  /**
   * Remember words that reveal a security context (rule 012).
   * @param {Unit} unit
   * @param {FortranToken[]} tokens
   */
  recordMentions(unit, tokens) {
    if (unit.secretWord) return;
    for (const token of tokens) {
      if (token.type === 'name' && isSecretContextWord(token.lower)) {
        unit.secretWord = token.lower;
        return;
      }
      if (token.type === 'string') {
        for (const word of wordsOf(token.value)) {
          if (isSecretContextWord(word)) {
            unit.secretWord = word.toLowerCase();
            return;
          }
        }
      }
    }
  }

  /**
   * @param {string} name
   * @returns {Decl|null}
   */
  lookup(name) {
    for (let unit = this.current; unit; unit = unit.parent) {
      const decl = unit.decls.get(name);
      if (decl) return decl;
    }
    return null;
  }

  // ------------------------------------------------------------ analysis

  /**
   * @param {Unit} unit
   * @param {FortranToken[]} tokens
   * @param {boolean} assignment
   */
  analyze(unit, tokens, assignment) {
    const scope = { lookup: (name) => this.lookup(name), sink: this.sink };
    if (!assignment && this.specification(unit, tokens)) return;
    checkComparisons(scope, tokens);
    checkShortCircuit(scope, tokens, assignment);
    this.executable(unit, tokens, assignment);
  }

  /**
   * Declarations and other specification statements.
   * @param {Unit} unit
   * @param {FortranToken[]} tokens
   * @returns {boolean}
   */
  specification(unit, tokens) {
    const decl = parseDeclaration(tokens);
    if (decl) {
      this.declarationChecks(decl);
      this.recordDeclaration(unit, decl);
      return true;
    }
    switch (nameOf(tokens[0])) {
      case 'dimension': this.dimensionStatement(unit, tokens); return true;
      case 'parameter': this.parameterStatement(unit, tokens); return true;
      case 'data': this.dataStatement(tokens); return true;
      case 'equivalence': {
        const names = tokens.filter((t) => t.type === 'name').slice(1, 3).map((t) => escapeInvisible(t.value));
        this.sink.addAt('ALZ-FOR-003', tokens[0],
          `EQUIVALENCE makes ${names.join(' and ') || 'variables'} share the same storage: writing one silently reinterprets the bytes of the other (type confusion).`);
        return true;
      }
      case 'common': {
        const block = isOp(tokens[1], '/') && tokens[2]?.type === 'name' ? `/${escapeInvisible(tokens[2].value)}/` : 'blank COMMON';
        this.sink.addAt('ALZ-FOR-004', tokens[0],
          `COMMON ${block} shares global storage whose layout every unit redeclares unchecked: one mismatch silently shifts every following field.`);
        return true;
      }
      case 'format':
      case 'use':
      case 'save':
      case 'external':
      case 'intrinsic':
      case 'namelist':
      case 'public':
      case 'private':
        return true;
      default:
        return false;
    }
  }

  /**
   * Rules on a declaration that do not depend on scope (009, 010).
   * @param {import('./syntax.mjs').Declaration} decl
   */
  declarationChecks(decl) {
    for (const entity of decl.entities) {
      if (decl.typeName === 'character' && entity.init && isFortranCredentialName(entity.name)) {
        const literal = literalInit(entity.init);
        if (literal) {
          this.sink.addAt('ALZ-FOR-009', literal,
            `${escapeInvisible(entity.token.value)} is initialised with a hard-coded ${literal.value.length}-character literal: it is compiled into the binary (visible with \`strings\`). Load it at run time.`);
        }
      }
      if (decl.typeName === 'real' && isSinglePrecision(decl.kind) && isFortranMonetaryName(entity.name)) {
        this.sink.addAt('ALZ-FOR-010', entity.token,
          `${escapeInvisible(entity.token.value)} holds money in single-precision REAL (about 7 significant digits): amounts above 100,000.00 lose cents. Use integer cents or real(real64).`);
      }
    }
  }

  /**
   * Record declared names (scope for 011, 012, 014) and check 002.
   * @param {Unit} unit
   * @param {import('./syntax.mjs').Declaration} decl
   */
  recordDeclaration(unit, decl) {
    const dimension = decl.attrs.has('dimension') ? decl.attrs.get('dimension') ?? null : null;
    const isParameter = decl.attrs.has('parameter');
    for (const entity of decl.entities) {
      const arraySpec = entity.arraySpec ?? dimension;
      const previous = unit.decls.get(entity.name);
      unit.decls.set(entity.name, {
        typeName: decl.typeName,
        isArray: arraySpec !== null || (previous?.isArray ?? false),
        isParameter: isParameter || (previous?.isParameter ?? false),
      });
      if (isAssumedSize(arraySpec) && !isParameter) this.assumedSize(unit, entity.token);
    }
  }

  /**
   * @param {Unit} unit
   * @param {FortranToken} token
   */
  assumedSize(unit, token) {
    if (!unit.dummies.has(token.lower) || unit.isInterfaceBody) return;
    const name = escapeInvisible(token.value);
    if (unit.bindC) {
      this.sink.addAt('ALZ-FOR-002', token,
        `Assumed-size dummy array ${name} in a BIND(C) procedure: C interop requires assumed-size; validate the explicit length argument before every access.`,
        'info');
      return;
    }
    this.sink.addAt('ALZ-FOR-002', token,
      `Assumed-size dummy array ${name}(*) has no known extent: bounds checking cannot protect it and an input-derived index reads or writes past the caller's buffer. Use ${name}(:) or pass the length.`);
  }

  /**
   * DIMENSION [::] a(10), b(*)
   * @param {Unit} unit
   * @param {FortranToken[]} tokens
   */
  dimensionStatement(unit, tokens) {
    const start = isOp(tokens[1], '::') ? 2 : 1;
    for (const entity of parseEntities(tokens, start, tokens.length)) {
      const previous = unit.decls.get(entity.name);
      unit.decls.set(entity.name, {
        typeName: previous?.typeName ?? null, isArray: true, isParameter: previous?.isParameter ?? false,
      });
      if (isAssumedSize(entity.arraySpec)) this.assumedSize(unit, entity.token);
    }
  }

  /**
   * PARAMETER (name = expr, ...)
   * @param {Unit} unit
   * @param {FortranToken[]} tokens
   */
  parameterStatement(unit, tokens) {
    if (!isOp(tokens[1], '(')) return;
    const close = matchParen(tokens, 1);
    if (close === -1) return;
    for (const [s, e] of splitTopLevel(tokens, 2, close)) {
      const nameToken = tokens[s];
      if (nameToken?.type !== 'name' || !isOp(tokens[s + 1], '=')) continue;
      const previous = unit.decls.get(nameToken.lower);
      unit.decls.set(nameToken.lower, { typeName: previous?.typeName ?? null, isArray: previous?.isArray ?? false, isParameter: true });
      const literal = isFortranCredentialName(nameToken.lower) ? literalInit(tokens.slice(s + 2, e)) : null;
      if (literal) {
        this.sink.addAt('ALZ-FOR-009', literal,
          `PARAMETER ${escapeInvisible(nameToken.value)} hard-codes a ${literal.value.length}-character credential literal: it is compiled into the binary. Load it at run time.`);
      }
    }
  }

  /**
   * DATA name /'literal'/ [, ...]
   * @param {FortranToken[]} tokens
   */
  dataStatement(tokens) {
    for (let k = 1; k < tokens.length; k++) {
      const nameToken = tokens[k];
      if (nameToken.type !== 'name' || !isOp(tokens[k + 1], '/') || !isFortranCredentialName(nameToken.lower)) continue;
      const value = tokens[k + 2];
      if (value?.type === 'string' && value.value.trim() !== '') {
        this.sink.addAt('ALZ-FOR-009', value,
          `DATA initialises ${escapeInvisible(nameToken.value)} with a hard-coded ${value.value.length}-character credential literal: it is compiled into the binary. Load it at run time.`);
      }
    }
  }

  /**
   * Executable statement rules (006, 007, 011, 012, 013), including the
   * action statement of a logical IF.
   * @param {Unit} unit
   * @param {FortranToken[]} tokens
   * @param {boolean} assignment
   */
  executable(unit, tokens, assignment) {
    this.randomUses(unit, tokens);
    if (assignment) return;
    const first = nameOf(tokens[0]);
    if (first === 'if' && isOp(tokens[1], '(')) {
      const close = matchParen(tokens, 1);
      const next = close === -1 ? undefined : tokens[close + 1];
      if (!next || nameOf(next) === 'then') return;
      if (next.type === 'number' && isOp(tokens[close + 2], ',')) {
        this.sink.addAt('ALZ-FOR-013', tokens[0],
          'Arithmetic IF jumps to one of three labels depending on the sign of an expression: control flow is hard to review and NaN takes an unexpected branch. Use IF / ELSE IF.');
        return;
      }
      const action = tokens.slice(close + 1);
      this.executableAction(unit, action);
      return;
    }
    this.executableAction(unit, tokens);
  }

  /**
   * @param {Unit} unit
   * @param {FortranToken[]} tokens
   */
  executableAction(unit, tokens) {
    if (isAssignment(tokens)) return;
    const first = nameOf(tokens[0]);
    if (first === 'call') this.callStatement(tokens);
    else if (first && IO_VERBS.has(first)) this.ioStatement(tokens, first);
    else if (first === 'print') this.formatOperand(tokens[1], tokens[2]);
    else if (first === 'go' && nameOf(tokens[1]) === 'to') this.gotoStatement(tokens, 2);
    else if (first === 'goto') this.gotoStatement(tokens, 1);
    else if (first === 'assign' && tokens[1]?.type === 'number' && nameOf(tokens[2]) === 'to') {
      this.sink.addAt('ALZ-FOR-013', tokens[0],
        'ASSIGN stores a statement label in a variable for an assigned GO TO: the jump target is data, not code. Use SELECT CASE or procedures.');
    }
  }

  /**
   * @param {FortranToken[]} tokens
   * @param {number} k index after GO TO
   */
  gotoStatement(tokens, k) {
    if (isOp(tokens[k], '(')) {
      this.sink.addAt('ALZ-FOR-013', tokens[0],
        'Computed GO TO picks a label by index: an out-of-range value silently falls through. Use SELECT CASE.');
    } else if (tokens[k]?.type === 'name') {
      this.sink.addAt('ALZ-FOR-013', tokens[0],
        `Assigned GO TO jumps to the label stored in ${escapeInvisible(tokens[k].value)}: the target is data, not code. Use SELECT CASE.`);
    }
  }

  /** @param {FortranToken[]} tokens */
  callStatement(tokens) {
    const callee = nameOf(tokens[1]);
    if (callee !== 'execute_command_line' && callee !== 'system') return;
    if (!isOp(tokens[2], '(')) return;
    const close = matchParen(tokens, 2);
    if (close === -1) return;
    const args = splitTopLevel(tokens, 3, close).map(([s, e]) => tokens.slice(s, e));
    const command = args.find((arg) => nameOf(arg[0]) === 'command' && isOp(arg[1], '='))?.slice(2) ?? args[0];
    if (!command || command.length === 0) return;
    const literal = command.every((t) => t.type === 'string' || isOp(t, '//'));
    const what = callee === 'system' ? 'CALL SYSTEM' : 'execute_command_line';
    if (literal) {
      this.sink.addAt('ALZ-FOR-007', tokens[1],
        `${what} runs a fixed shell command; replace it with a library routine where possible.`, 'medium');
    } else {
      this.sink.addAt('ALZ-FOR-007', tokens[1],
        `${what} runs a command built at run time through the shell: any input that reaches it can inject shell metacharacters.`, 'high');
    }
  }

  /**
   * OPEN / READ / WRITE / CLOSE / INQUIRE.
   * @param {FortranToken[]} tokens
   * @param {string} verb
   */
  ioStatement(tokens, verb) {
    const list = controlList(tokens, 1);
    if (!list) {
      if (verb === 'read' && tokens.length > 1) {
        this.missingIostat(tokens[0], 'READ', 'end-of-file or bad input stops the program');
        this.formatOperand(tokens[1], tokens[2]);
      }
      return;
    }
    if (list.items.some((item) => item.keyword === 'iolength')) return;
    const hasIostat = list.items.some((item) => item.keyword === 'iostat');
    const unitItem = list.items.find((item) => item.keyword === 'unit') ?? list.items.find((item) => item.keyword === null);
    const exempt = isConsoleUnit(unitItem?.value) || (verb === 'write' && this.isInternalFile(unitItem?.value));
    if (!hasIostat && (verb === 'open' || verb === 'read' || !exempt)) {
      const branches = list.items.some((item) => item.keyword === 'err' || item.keyword === 'end' || item.keyword === 'eor');
      const effect = branches ? 'the ERR=/END= branch loses the cause of the error'
        : verb === 'read' ? 'end-of-file or a malformed record stops the program'
          : verb === 'open' ? 'a missing or locked file stops the program' : 'an I/O error stops the program';
      this.missingIostat(tokens[0], verb.toUpperCase(), effect);
    }
    if ((verb === 'read' || verb === 'write') && !list.items.some((item) => item.keyword === 'nml')) {
      const positional = list.items.filter((item) => item.keyword === null);
      const format = list.items.find((item) => item.keyword === 'fmt')?.value ?? positional[1]?.value;
      if (format && format.length === 1) this.formatOperand(format[0], undefined);
    }
  }

  /**
   * A WRITE to a character variable (internal file) formats into memory and
   * has no external I/O that can fail.
   * @param {FortranToken[]|undefined} value
   * @returns {boolean}
   */
  isInternalFile(value) {
    if (!value || value.length === 0 || value[0].type !== 'name') return false;
    const decl = this.lookup(value[0].lower);
    return decl !== null && decl.typeName === 'character' && !decl.isParameter;
  }

  /**
   * @param {FortranToken} token
   * @param {string} verb
   * @param {string} effect
   */
  missingIostat(token, verb, effect) {
    this.sink.addAt('ALZ-FOR-006', token, `${verb} without IOSTAT=: ${effect}. Add iostat= (and iomsg=) and check it.`);
  }

  /**
   * A format given by a non-PARAMETER character variable (rule 011).
   * @param {FortranToken|undefined} token
   * @param {FortranToken|undefined} after token following it (print/read short form)
   */
  formatOperand(token, after) {
    if (!token || token.type !== 'name') return;
    if (after && !isOp(after, ',')) return;
    const decl = this.lookup(token.lower);
    if (!decl || decl.typeName !== 'character' || decl.isParameter || decl.isArray) return;
    this.sink.addAt('ALZ-FOR-011', token,
      `The format of this statement comes from the character variable ${escapeInvisible(token.value)}: if input can reach it, an attacker controls how data is parsed or printed. Use a literal or a PARAMETER.`);
  }

  /**
   * random_number / rand( / ran( uses (rule 012, evaluated per unit at the end).
   * @param {Unit} unit
   * @param {FortranToken[]} tokens
   */
  randomUses(unit, tokens) {
    for (let k = 0; k < tokens.length; k++) {
      const token = tokens[k];
      if (token.type !== 'name' || isOp(tokens[k - 1], '%')) continue;
      const isCall = token.lower === 'random_number';
      const isFunction = (token.lower === 'rand' || token.lower === 'ran') && isOp(tokens[k + 1], '(');
      if ((isCall || isFunction) && !this.lookup(token.lower)) unit.randomUses.push(token);
    }
  }
}

/**
 * Strip a construct name ("outer: do ...").
 * @param {FortranToken[]} tokens
 * @returns {FortranToken[]}
 */
function stripConstructName(tokens) {
  if (tokens.length > 2 && tokens[0].type === 'name' && isOp(tokens[1], ':') && tokens[2].type === 'name') {
    return tokens.slice(2);
  }
  return tokens;
}

/**
 * TYPE [,attrs ::] name - a derived-type definition, not TYPE(t) or TYPE IS.
 * @param {FortranToken[]} tokens
 * @returns {boolean}
 */
function isTypeDefinition(tokens) {
  const next = tokens[1];
  if (!next || isOp(next, '(')) return false;
  if (nameOf(next) === 'is' && isOp(tokens[2], '(')) return false;
  return true;
}

/**
 * IMPLICIT NONE, IMPLICIT NONE () or IMPLICIT NONE (TYPE[, EXTERNAL]).
 * @param {FortranToken[]} tokens
 * @returns {boolean}
 */
function isImplicitNone(tokens) {
  let k;
  if (nameOf(tokens[0]) === 'implicitnone') k = 1;
  else if (nameOf(tokens[1]) === 'none') k = 2;
  else return false;
  if (!isOp(tokens[k], '(')) return true;
  const close = matchParen(tokens, k);
  const specs = tokens.slice(k + 1, close === -1 ? tokens.length : close).filter((t) => t.type === 'name').map((t) => t.lower);
  return specs.length === 0 || specs.includes('type');
}

/**
 * Default, *4, (4), (kind=4), (sp), (real32), (c_float) or kind(1.0).
 * @param {FortranToken[]|null} kind
 * @returns {boolean}
 */
function isSinglePrecision(kind) {
  if (kind === null) return true;
  let tokens = kind;
  if (nameOf(tokens[0]) === 'kind' && isOp(tokens[1], '=')) tokens = tokens.slice(2);
  if (tokens.length === 1) return SINGLE_KINDS.has(tokens[0].lower);
  if (nameOf(tokens[0]) === 'kind' && isOp(tokens[1], '(') && tokens.length === 4) {
    const literal = tokens[2];
    return isRealLiteral(literal) && !literal.lower.includes('d') && !literal.lower.includes('_');
  }
  return false;
}

/**
 * The string literal of a "= 'literal'" initialisation, if non-blank.
 * @param {FortranToken[]} init
 * @returns {FortranToken|null}
 */
function literalInit(init) {
  const first = init[0];
  if (!first || first.type !== 'string' || first.value.trim() === '') return null;
  return init.every((t) => t.type === 'string' || isOp(t, '//')) ? first : null;
}

/**
 * @param {FortranToken[]|undefined} value
 * @returns {boolean}
 */
function isConsoleUnit(value) {
  if (!value || value.length !== 1) return false;
  const token = value[0];
  if (isOp(token, '*')) return true;
  if (token.type === 'number') return token.value === '6' || token.value === '0';
  return token.type === 'name' && CONSOLE_UNITS.has(token.lower);
}

/**
 * Secret-context word of a unit or its procedure hosts (stops at modules).
 * @param {Unit} unit
 * @returns {string|null}
 */
function secretContext(unit) {
  /** @type {Unit|null} */
  let scope = unit;
  while (scope) {
    if (scope.secretWord) return scope.secretWord;
    const host = scope.parent;
    if (!host || host.kind === 'module' || host.kind === 'submodule' || host.kind === 'program') return null;
    scope = host;
  }
  return null;
}

/**
 * Words (letters, digits, underscore) of a string literal.
 * @param {string} text
 * @returns {string[]}
 */
function wordsOf(text) {
  const words = [];
  let start = -1;
  for (let i = 0; i <= text.length; i++) {
    const code = text.charCodeAt(i);
    const inWord = i < text.length && (isAsciiLetterCode(code) || isDigitCode(code) || code === 95);
    if (inWord && start === -1) start = i;
    else if (!inWord && start !== -1) {
      words.push(text.slice(start, i));
      start = -1;
    }
  }
  return words;
}

/** @param {string} text */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
