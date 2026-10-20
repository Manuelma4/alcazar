#!/usr/bin/env node
/**
 * Watchtower command-line interface.
 *
 *   watchtower scan [paths...] [--format text|json|sarif] [--output file]
 *                   [--fail-on critical|high|medium|low|info|none]
 *                   [--exclude glob]... [--no-color]
 *   watchtower rules
 *   watchtower --version | --help
 *
 * Exit codes: 0 ok, 1 findings at or above --fail-on, 2 usage or I/O error.
 * The CLI reads source files and writes only the --output file; it never
 * executes anything and never follows symbolic links.
 */
import { closeSync, constants, openSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import {
  RULES, SEVERITIES, SOURCE_EXTENSIONS, VERSION, countAtOrAbove, formatText, scan, summarize, toSarif,
} from '../src/index.mjs';
import { collectFiles, copybookResolver, readSourceFile } from '../src/node/files.mjs';

const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_USAGE = 2;
const FORMATS = new Set(['text', 'json', 'sarif']);
const THRESHOLDS = new Set([...SEVERITIES, 'none']);

const HELP = `Watchtower ${VERSION} - static security analysis for legacy COBOL and Fortran

Usage:
  watchtower scan [paths...]      Scan files or directories (default: .)
  watchtower rules                List the rules
  watchtower --version            Print the version
  watchtower --help               Show this help

Scan options:
  --format text|json|sarif        Output format (default: text)
  --output <file>                 Write the report to a file instead of stdout
  --fail-on <severity>            Exit 1 when an unsuppressed finding is at or above
                                  critical|high|medium|low|info, or never with none
                                  (default: high)
  --exclude <glob>                Skip matching paths (repeatable; supports **, *, ?).
                                  node_modules, .git, build and dist are always skipped
  --no-color                      Disable ANSI colours (NO_COLOR is honoured too)

Files: .cob .cbl .cpy .cobol (COBOL), .f90 .f95 .f03 .f08 .f18 (free-form Fortran),
.f .for .ftn .f77 (fixed-form Fortran). Symbolic links and files over 2 MB are skipped.
Suppress a finding with a justified comment, e.g.
  *> watchtower-ignore ALZ-COB-005 -- value is masked by ALZMASK
  ! watchtower-ignore ALZ-FOR-002 -- length validated by the caller
Exit codes: 0 ok, 1 findings at or above --fail-on, 2 usage or I/O error.`;

class UsageError extends Error {}

/**
 * @typedef {object} ScanArgs
 * @property {string[]} paths
 * @property {'text'|'json'|'sarif'} format
 * @property {string|null} output
 * @property {string} failOn
 * @property {string[]} excludes
 * @property {boolean} noColor
 */

/**
 * @param {string[]} argv
 * @returns {ScanArgs}
 */
function parseScanArgs(argv) {
  /** @type {ScanArgs} */
  const args = { paths: [], format: 'text', output: null, failOn: 'high', excludes: [], noColor: false };
  let onlyPaths = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (onlyPaths || !arg.startsWith('-') || arg === '-') {
      args.paths.push(arg);
      continue;
    }
    if (arg === '--') {
      onlyPaths = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg : arg.slice(0, eq);
    const takeValue = () => {
      if (eq !== -1) return arg.slice(eq + 1);
      const value = argv[i + 1];
      if (value === undefined) throw new UsageError(`${name} needs a value`);
      i += 1;
      return value;
    };
    switch (name) {
      case '--format': {
        const value = takeValue();
        if (!FORMATS.has(value)) throw new UsageError(`--format must be text, json or sarif (got "${value}")`);
        args.format = /** @type {ScanArgs['format']} */ (value);
        break;
      }
      case '--output':
      case '-o':
        args.output = takeValue();
        if (args.output === '') throw new UsageError('--output needs a file name');
        break;
      case '--fail-on': {
        const value = takeValue();
        if (!THRESHOLDS.has(value)) throw new UsageError(`--fail-on must be one of ${[...THRESHOLDS].join(', ')} (got "${value}")`);
        args.failOn = value;
        break;
      }
      case '--exclude':
        args.excludes.push(takeValue());
        break;
      case '--no-color':
        if (eq !== -1) throw new UsageError('--no-color takes no value');
        args.noColor = true;
        break;
      default:
        throw new UsageError(`unknown option ${name}`);
    }
  }
  if (args.paths.length === 0) args.paths.push('.');
  return args;
}

/**
 * @param {string} message
 */
function warn(message) {
  process.stderr.write(`watchtower: ${message}\n`);
}

/**
 * Write the report without following a symbolic link at the destination.
 * @param {string} path
 * @param {string} data
 */
function writeReport(path, data) {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0);
  const bytes = new TextEncoder().encode(data);
  const fd = openSync(path, flags, 0o644);
  try {
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  } finally {
    closeSync(fd);
  }
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function runScan(argv) {
  const args = parseScanArgs(argv);
  const cwd = process.cwd();
  const collected = collectFiles(args.paths, { cwd, excludes: args.excludes, extensions: SOURCE_EXTENSIONS });
  for (const message of collected.warnings) warn(`warning: ${message}`);
  if (collected.errors.length > 0) {
    for (const message of collected.errors) warn(`error: ${message}`);
    return EXIT_USAGE;
  }
  let ioError = false;
  const results = [];
  for (const file of collected.files) {
    let source;
    try {
      source = readSourceFile(file.path);
    } catch (error) {
      warn(`error: cannot read ${file.rel}: ${/** @type {Error} */ (error).message}`);
      ioError = true;
      continue;
    }
    const result = scan(source, { filename: file.rel, resolveCopybook: copybookResolver(file.path) });
    results.push({ file: file.rel, ...result });
  }
  const report = render(results, args);
  try {
    if (args.output) writeReport(resolve(cwd, args.output), report);
    else process.stdout.write(report);
  } catch (error) {
    warn(`error: cannot write ${args.output}: ${/** @type {NodeJS.ErrnoException} */ (error).code ?? /** @type {Error} */ (error).message}`);
    return EXIT_USAGE;
  }
  if (ioError) return EXIT_USAGE;
  return countAtOrAbove(results, args.failOn) > 0 ? EXIT_FINDINGS : EXIT_OK;
}

/**
 * @param {import('../src/report/summary.mjs').FileResult[]} results
 * @param {ScanArgs} args
 * @returns {string}
 */
function render(results, args) {
  if (args.format === 'json') {
    const payload = {
      tool: { name: 'Watchtower', version: VERSION },
      summary: summarize(results),
      results: results.map(({ file, language, format, findings, suppressed }) => ({ file, language, format, findings, suppressed })),
    };
    return `${JSON.stringify(payload, null, 2)}\n`;
  }
  if (args.format === 'sarif') return `${JSON.stringify(toSarif(results, { srcRoot: process.cwd() }), null, 2)}\n`;
  const noColorEnv = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '';
  const color = !args.noColor && !noColorEnv && !args.output && process.stdout.isTTY === true;
  return formatText(results, { color, failOn: args.failOn });
}

/** @returns {string} */
function rulesTable() {
  const header = ['ID', 'SEVERITY', 'CWE', 'LANGUAGE', 'TITLE'];
  const rows = RULES.map((rule) => [rule.id, rule.severity, rule.cwe, rule.language, rule.title]);
  const widths = header.map((_, column) => Math.max(header[column].length, ...rows.map((row) => row[column].length)));
  const format = (row) => row.map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column]))).join('  ');
  return `${[format(header), format(widths.map((w) => '-'.repeat(w))), ...rows.map(format)].join('\n')}\n`;
}

/**
 * @param {string[]} argv
 * @returns {number}
 */
function main(argv) {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case undefined:
      case '--help':
      case '-h':
      case 'help':
        process.stdout.write(`${HELP}\n`);
        return EXIT_OK;
      case '--version':
      case '-v':
      case 'version':
        process.stdout.write(`${VERSION}\n`);
        return EXIT_OK;
      case 'rules':
        if (rest.length > 0) throw new UsageError(`unexpected argument ${rest[0]}`);
        process.stdout.write(rulesTable());
        return EXIT_OK;
      case 'scan':
        if (rest.includes('--help') || rest.includes('-h')) {
          process.stdout.write(`${HELP}\n`);
          return EXIT_OK;
        }
        return runScan(rest);
      default:
        throw new UsageError(`unknown command ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      warn(`${error.message}\nRun "watchtower --help" for usage.`);
      return EXIT_USAGE;
    }
    warn(`error: ${/** @type {Error} */ (error).message}`);
    return EXIT_USAGE;
  }
}

process.stdout.on('error', (error) => {
  if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EPIPE') process.exit(process.exitCode ?? 0);
});
process.exitCode = main(process.argv.slice(2));
