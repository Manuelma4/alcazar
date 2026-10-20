/**
 * COBOL analysis pipeline: lex -> structure -> symbol table -> statements
 * -> rules.
 */
import { FindingSink } from '../finding.mjs';
import { checkData } from './checks-data.mjs';
import { checkProcedure } from './checks-procedure.mjs';
import { lexCobol } from './lexer.mjs';
import { procedureStatements } from './statements.mjs';
import { divisionRanges, execBlocks } from './structure.mjs';
import { buildSymbolTable } from './symbols.mjs';

/**
 * @typedef {object} LanguageAnalysis
 * @property {'fixed'|'free'} format
 * @property {string[]} lines
 * @property {FindingSink} sink
 * @property {import('../suppress.mjs').SourceComment[]} comments
 * @property {number[]} codeLines
 * @property {import('../generic.mjs').IdentifierToken[]} identifiers
 */

/**
 * @param {string} source
 * @param {{ format?: 'fixed'|'free', resolveCopybook?: (name: string) => (string|null|undefined) }} [options]
 * @returns {LanguageAnalysis}
 */
export function analyzeCobol(source, options = {}) {
  const lex = lexCobol(source, { format: options.format });
  const tokens = lex.tokens;
  const ranges = divisionRanges(tokens);
  const exec = execBlocks(tokens);
  const symbols = buildSymbolTable(tokens, ranges, { resolveCopybook: options.resolveCopybook });
  const statements = procedureStatements(tokens, ranges, exec.inExec);
  const sink = new FindingSink(lex.lines);
  const ctx = { lex, tokens, ranges, exec, symbols, statements, sink };
  checkData(ctx);
  checkProcedure(ctx);
  return {
    format: lex.format,
    lines: lex.lines,
    sink,
    comments: lex.comments,
    codeLines: lex.codeLines,
    identifiers: tokens.filter((token) => token.type === 'word'),
  };
}
