# Watchtower

Watchtower is the static security analyzer (SAST) of [Alcazar](../docs/ARCHITECTURE.md), the security
toolkit for legacy COBOL and Fortran. It finds the security pitfalls that are specific to those
languages (sign loss in a `MOVE`, money held in `COMP-2`, a condition hidden in columns 73-80,
assumed-size arrays, missing `IMPLICIT NONE`, timing-unsafe secret comparisons, Trojan Source
characters...) and reports them as a terminal report, JSON, or SARIF 2.1.0 for GitHub code scanning.

- **Zero dependencies.** Plain modern JavaScript (ESM), no npm packages at run time or for tests.
- **Fast and ReDoS-safe.** Hand-written single-pass lexers; no backtracking regular expressions run on
  scanned code. A 200,000-character pathological line scans in tens of milliseconds.
- **Low false positives.** Rules use a real token stream, a DATA DIVISION symbol table with PICTURE
  typing, Fortran program-unit and scope tracking, and prove some results safe (for example an
  arithmetic result that always fits its receiver) instead of guessing.
- **Runs in the browser.** Everything under `src/` (except `src/node/`) is browser-safe; the Lookout
  dashboard imports it to scan pasted code client-side.

## Quick start

```sh
node watchtower/bin/watchtower.mjs scan examples/vulnerable      # intentionally vulnerable samples
node watchtower/bin/watchtower.mjs scan examples/hardened --fail-on info
node watchtower/bin/watchtower.mjs scan rampart apps --fail-on info   # what CI runs
node watchtower/bin/watchtower.mjs rules
```

With the root `package.json` `bin` entry the same commands are available as `watchtower scan ...`
(for example after `npm link`).

```text
▸ examples/vulnerable/ACCTXFER.cbl  cobol · fixed · 15 findings

   HIGH      ALZ-COB-006  Signed to unsigned MOVE (sign loss)  CWE-195
  examples/vulnerable/ACCTXFER.cbl:79:32
   79 │ 007900     MOVE WS-XFER-AMT TO WS-POSTED-AMT
      │                                ^^^^^^^^^^^^^
  Signed WS-XFER-AMT (PIC S9(9)V99) is moved to unsigned WS-POSTED-AMT (PIC 9(9)V99): a negative
  value silently loses its sign (-500.00 becomes 500.00).
  fix: Give the receiver a signed PICTURE (PIC S9(n)V99), or test the sign explicitly ...
```

## Command line

```text
watchtower scan [paths...]          scan files and directories (default: .)
  --format text|json|sarif          output format (default: text)
  --output <file>                   write the report to a file instead of stdout
  --fail-on critical|high|medium|low|info|none
                                    exit 1 when an unsuppressed finding is at or above the
                                    severity (default: high; none never fails)
  --exclude <glob>                  skip matching paths; repeatable; supports **, * and ?
  --no-color                        no ANSI colours (NO_COLOR is honoured as well)
watchtower rules                    print the rule table
watchtower --version | --help
```

Exit codes: **0** no unsuppressed finding at or above `--fail-on`, **1** findings at or above it,
**2** usage or I/O error (unknown option, missing path, unreadable file, output not writable).

Files and safety:

- Directories are walked recursively and in a stable order. Extensions (any case): COBOL `.cob .cbl
  .cpy .cobol`; free-form Fortran `.f90 .f95 .f03 .f08 .f18`; fixed-form Fortran `.f .for .ftn .f77`.
  A file named explicitly is scanned whatever its extension (its language is sniffed).
- `node_modules`, `.git`, `build` and `dist` are always excluded. A pattern without `/` matches any
  path segment (`--exclude '*.cpy'`), a pattern with `/` matches the relative path
  (`--exclude 'examples/**'`).
- Symbolic links are never followed (files are opened with `O_NOFOLLOW`), files larger than 2 MB are
  skipped with a warning, and the only file ever written is the `--output` file (not through a link).
  Nothing is executed.
- COBOL `COPY name.` members are resolved from the directory of the including file (no paths, no
  links, size-limited, recursion-guarded) to type the data items they declare. Findings are never
  reported inside a copybook from the including program; scan the copybook itself for that.
- Colour is used only for the text format, when stdout is a TTY, `--no-color` is absent and `NO_COLOR`
  is unset. Paths in every output are relative to the current directory, with forward slashes.

## Output formats

**Text**: one block per file with a severity badge, `file:line:col`, rule id, title and CWE, the
source line with a caret under the finding, the message and a one-line fix, then a summary by
severity and a PASS/FAIL verdict for the chosen `--fail-on`. Control, bidi and invisible characters
from the scanned code are replaced by U+FFFD, so a Trojan Source sample cannot reorder the report.

**JSON** (`--format json`):

```json
{
  "tool": { "name": "Watchtower", "version": "0.1.0" },
  "summary": { "files": 8, "findings": 72, "suppressed": 0,
               "bySeverity": { "critical": 3, "high": 14, "medium": 28, "low": 27, "info": 0 },
               "byRule": { "ALZ-COB-001": 1 } },
  "results": [
    { "file": "examples/vulnerable/ACCTXFER.cbl", "language": "cobol", "format": "fixed",
      "findings": [ { "ruleId": "ALZ-COB-001", "severity": "high", "title": "...", "message": "...",
                      "line": 95, "column": 17, "endColumn": 29, "snippet": "...", "cwe": "CWE-470",
                      "fix": "..." } ],
      "suppressed": [ { "...": "...", "suppression": { "justification": "..." } } ] }
  ]
}
```

Lines and columns are 1-based positions in the original file (UTF-16 code units); `endColumn` is
exclusive. Findings are ordered by file path, line, column and rule id.

**SARIF 2.1.0** (`--format sarif`): one run with `tool.driver.name = "Watchtower"`, every rule with
its CWE tag, precision and `security-severity` (critical 9.5, high 8.0, medium 5.5, low 3.0,
info 1.0), results with `%SRCROOT%`-relative locations, a snippet, a stable
`partialFingerprints.primaryLocationLineHash` (FNV-1a 64-bit of rule id + whitespace-normalised line),
and suppressed findings with `suppressions: [{ kind: "inSource", justification }]`. Levels:
critical/high = `error`, medium = `warning`, low/info = `note`.

### GitHub code scanning — the Watchtower action

`watchtower/action.yml` packages the CLI as a composite GitHub Action: it
installs Node 24, writes the SARIF report first (so an upload step with
`if: always()` has it even when the gate fails), then prints the text report
and fails the job at the chosen severity.

```yaml
name: watchtower
on: [push, pull_request]
permissions:
  contents: read
  security-events: write
jobs:
  sast:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: Manuelma4/alcazar/watchtower@main  # pin a release commit SHA in production
        with:
          paths: src/cobol src/fortran    # spaces or new lines
          fail-on: high                   # critical | high | medium | low | info | none
          exclude: '**/generated/**'      # optional glob patterns
          sarif-file: watchtower.sarif    # default
      - uses: github/codeql-action/upload-sarif@6f2ac81f5cd81fe351a197ba0b00d91d03cd2aee # v4.39.0
        if: always()
        with:
          sarif_file: watchtower.sarif
          category: watchtower
```

Inputs reach the action's script through environment variables, never by
template expansion inside it, so a path or pattern cannot inject shell code.
Paths containing spaces are not supported.

## Suppressions

Suppressions are explicit and justified:

```cobol
           DISPLAY WS-PAN-HASH *> watchtower-ignore ALZ-COB-005 -- keyed hash, not the PAN
      * watchtower-ignore ALZ-COB-001 -- WS-HANDLER is checked against HANDLER-TABLE above
           CALL WS-HANDLER USING WS-REQUEST
```

```fortran
  ! watchtower-ignore ALZ-FOR-002 -- C interop needs assumed size; n is range-checked first
  integer(c_int8_t), intent(in) :: buf(*)
  open (newunit=u, file=path) ! watchtower-ignore ALZ-FOR-006 -- demo only, errors abort on purpose
```

- COBOL: an inline `*>` comment, or a comment line with `*` in column 7 (fixed format).
  Fortran: a `!` comment.
- A comment that trails code applies to its own line; a comment alone on a line applies to the next
  line that contains code (blank and comment lines in between are skipped).
- Several ids may be listed, separated by commas or blanks.
- **Without `-- reason` the suppression is ignored** and the finding stays, with a note in its message.
- Suppressed findings are counted apart: they never fail `--fail-on`, and they stay visible in the
  JSON (`suppressed`) and SARIF (`suppressions`) outputs.

## Rules

| Rule | Severity | CWE | Language | Title |
|---|---|---|---|---|
| [ALZ-COB-001](../docs/rules/ALZ-COB-001.md) | High | CWE-470 | COBOL | Dynamic CALL target from a data item |
| [ALZ-COB-002](../docs/rules/ALZ-COB-002.md) | Critical | CWE-78 | COBOL | OS command execution via CALL "SYSTEM" |
| [ALZ-COB-003](../docs/rules/ALZ-COB-003.md) | High | CWE-89 | COBOL | Dynamic SQL built from a host variable |
| [ALZ-COB-004](../docs/rules/ALZ-COB-004.md) | High | CWE-798 | COBOL | Hard-coded credential in a VALUE clause |
| [ALZ-COB-005](../docs/rules/ALZ-COB-005.md) | Medium | CWE-532 | COBOL | Sensitive data written with DISPLAY |
| [ALZ-COB-006](../docs/rules/ALZ-COB-006.md) | High | CWE-195 | COBOL | Signed to unsigned MOVE (sign loss) |
| [ALZ-COB-007](../docs/rules/ALZ-COB-007.md) | Medium | CWE-197 | COBOL | Numeric truncation in MOVE |
| [ALZ-COB-008](../docs/rules/ALZ-COB-008.md) | Low | CWE-222 | COBOL | Alphanumeric truncation in MOVE |
| [ALZ-COB-009](../docs/rules/ALZ-COB-009.md) | Medium | CWE-190 | COBOL | Monetary arithmetic without ON SIZE ERROR |
| [ALZ-COB-010](../docs/rules/ALZ-COB-010.md) | Medium | CWE-369 | COBOL | Division without ON SIZE ERROR |
| [ALZ-COB-011](../docs/rules/ALZ-COB-011.md) | Medium | CWE-1339 | COBOL | Floating-point USAGE for a monetary field |
| [ALZ-COB-012](../docs/rules/ALZ-COB-012.md) | Low | CWE-252 | COBOL | File without FILE STATUS |
| [ALZ-COB-013](../docs/rules/ALZ-COB-013.md) | Low | CWE-682 | COBOL | Monetary multiplication or division without ROUNDED |
| [ALZ-COB-014](../docs/rules/ALZ-COB-014.md) | Medium | CWE-561 | COBOL | Code-like text beyond column 72 |
| [ALZ-COB-015](../docs/rules/ALZ-COB-015.md) | Low | CWE-691 | COBOL | ALTER statement (self-modifying control flow) |
| [ALZ-COB-016](../docs/rules/ALZ-COB-016.md) | Medium | CWE-130 | COBOL | LINE SEQUENTIAL input without record-length check |
| [ALZ-COB-017](../docs/rules/ALZ-COB-017.md) | Low | CWE-316 | COBOL | Secret read with ACCEPT |
| [ALZ-FOR-001](../docs/rules/ALZ-FOR-001.md) | Medium | CWE-457 | Fortran | Missing IMPLICIT NONE |
| [ALZ-FOR-002](../docs/rules/ALZ-FOR-002.md) | Medium | CWE-119 | Fortran | Assumed-size dummy array |
| [ALZ-FOR-003](../docs/rules/ALZ-FOR-003.md) | Medium | CWE-843 | Fortran | EQUIVALENCE storage aliasing |
| [ALZ-FOR-004](../docs/rules/ALZ-FOR-004.md) | Low | CWE-1108 | Fortran | COMMON block (unchecked global storage) |
| [ALZ-FOR-005](../docs/rules/ALZ-FOR-005.md) | Low | CWE-1077 | Fortran | Floating-point equality comparison |
| [ALZ-FOR-006](../docs/rules/ALZ-FOR-006.md) | Low | CWE-252 | Fortran | I/O statement without IOSTAT= |
| [ALZ-FOR-007](../docs/rules/ALZ-FOR-007.md) | High | CWE-78 | Fortran | OS command execution |
| [ALZ-FOR-008](../docs/rules/ALZ-FOR-008.md) | High | CWE-208 | Fortran | Non-constant-time comparison of a secret |
| [ALZ-FOR-009](../docs/rules/ALZ-FOR-009.md) | High | CWE-798 | Fortran | Hard-coded credential |
| [ALZ-FOR-010](../docs/rules/ALZ-FOR-010.md) | Medium | CWE-1339 | Fortran | Single-precision REAL for money |
| [ALZ-FOR-011](../docs/rules/ALZ-FOR-011.md) | Low | CWE-134 | Fortran | Format string taken from a variable |
| [ALZ-FOR-012](../docs/rules/ALZ-FOR-012.md) | High | CWE-338 | Fortran | Non-cryptographic PRNG used for secrets |
| [ALZ-FOR-013](../docs/rules/ALZ-FOR-013.md) | Low | CWE-691 | Fortran | Obsolescent control flow (arithmetic IF, computed or assigned GO TO) |
| [ALZ-FOR-014](../docs/rules/ALZ-FOR-014.md) | Medium | CWE-125 | Fortran | Bounds check not short-circuited |
| [ALZ-GEN-001](../docs/rules/ALZ-GEN-001.md) | Critical | CWE-451 | Any | Bidirectional control character (Trojan Source) |
| [ALZ-GEN-002](../docs/rules/ALZ-GEN-002.md) | High | CWE-1007 | Any | Invisible character or non-ASCII identifier (homoglyph) |
| [ALZ-GEN-003](../docs/rules/ALZ-GEN-003.md) | High | CWE-798 | Any | Secret material in source |

Every rule page under [`docs/rules/`](../docs/rules/) explains why the issue matters in legacy
systems, with a vulnerable and a fixed example.

## Use as a library (Node.js or browser)

```js
import { scan, RULES, VERSION, toSarif, formatText, summarize, detectLanguage } from '/watchtower/src/index.mjs';

const result = scan(code, { filename: 'PAYROLL.cob' });
// { language: 'cobol', format: 'fixed', findings: [...], suppressed: [...] }

const results = [{ file: 'PAYROLL.cob', ...result }];
summarize(results);                    // { files, findings, suppressed, bySeverity, byRule }
toSarif(results, { srcRoot: '/repo' }); // SARIF 2.1.0 object
formatText(results, { color: false, failOn: 'high' });
```

`scan(source, options)` options: `filename` (used for language and source-form detection),
`language` (`'cobol' | 'fortran' | 'unknown'`, skips detection), `format` (`'fixed' | 'free'`), and
`resolveCopybook(name)` returning the text of a COBOL copybook or `null` (the CLI supplies one that
reads the including file's directory). `detectLanguage(filename, source)` uses the extension first,
then content sniffing. `RULES` is a frozen array in a stable order:
`{ id, name, title, severity, cwe, language, precision, summary, rationale, fix, docs }`.

The browser build needs no bundler: serve the repository and import `watchtower/src/index.mjs`.
Only `watchtower/bin/` and `watchtower/src/node/` use Node.js APIs.

## Design notes

- **Lexers, not regular expressions.** The COBOL lexer handles fixed, free and variable reference
  formats (`>>SOURCE`, `$SET SOURCEFORMAT`), sequence and indicator areas, `-` continuation of words and
  literals (padded to column 72), `*>` comments outside literals, doubled-quote escapes, debugging
  lines and PICTURE character-strings. The Fortran lexer handles free form (`!`, `&`, `;`) and fixed
  form (column-1 comments, column-6 continuation, labels, tab form, columns 73+), dot operators and
  kind-suffixed literals. Every token keeps its original line and column.
- **Semantics where it pays.** A DATA DIVISION symbol table (levels, PICTURE and USAGE typing,
  `OCCURS`, `REDEFINES`, 88-levels, qualified names, copybooks) drives the MOVE and arithmetic rules;
  ambiguous names are treated as unknown rather than guessed. Fortran tracks program units, host
  association, interface bodies, derived types, `BIND(C)` and declarations per scope.
- **Prove, then report.** Magnitude bounds computed with exact BigInt arithmetic let ALZ-COB-009 stay
  quiet when a result always fits; ALZ-FOR-014 only reports accesses to names known to be arrays or
  strings; ALZ-FOR-008 ignores known-answer tests against constants.
- **Linear time.** Statement spans never overlap, scans are single-pass, recursion depth and lookaheads
  are bounded; the test suite feeds pathological inputs (200k-character lines of quotes, stars,
  `9(`, `&`, dot operators, bidi controls...) through every language mode with a 1-second budget.
- **Deterministic output.** Results are ordered by file path, line, column and rule id; SARIF and
  JSON are byte-for-byte stable for the same input.

## Limitations

- Heuristic analysis: there is no full data-flow or inter-procedural analysis. Money, secret and
  credential detection relies on naming conventions; unusual names are missed, and generic words are
  deliberately excluded to keep false positives low.
- Sources are read as UTF-8 (ASCII is a subset). EBCDIC files must be converted before scanning.
- COBOL `COPY` members are expanded for DATA DIVISION typing only, never in the PROCEDURE DIVISION,
  and members used with `REPLACING` are skipped. `REPLACE` and conditional compilation (`>>IF`) are
  not evaluated.
- Fixed-format COBOL assumes a right margin of column 72 (`>>SOURCE FORMAT IS VARIABLE` raises it);
  tabs expand to 8-column stops.
- Fortran: preprocessor (`#if`) lines are skipped, not evaluated; `INCLUDE` files are not read;
  use-associated names are unknown, so rules that need a declaration (format strings, short-circuit
  bounds) stay silent for them.
- Fortran identifiers split across fixed-form continuation lines are not rejoined.

## Tests

```sh
npm run test:watchtower
```

The suite covers both lexers, PICTURE parsing and the symbol table, every rule (positive and
negative cases), suppressions, SARIF/JSON/text output, the CLI (exit codes, formats, symlinks,
size limit, `--exclude`, `--output`), rule coverage of `examples/vulnerable`, zero findings on
`examples/hardened`, compilation of the examples with `cobc` / `gfortran` when they are installed,
browser safety of `src/`, and pathological-input performance.
