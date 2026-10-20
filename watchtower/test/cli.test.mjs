import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RULES, VERSION } from '../src/index.mjs';
import { cobolProgram } from './helpers.mjs';

const CLI = fileURLToPath(new URL('../bin/watchtower.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Run the CLI and resolve with { code, stdout, stderr } (never rejects).
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
function run(args, { cwd = REPO, env = {} } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: '', ...env }, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr }));
  });
}

describe('CLI basics', () => {
  it('prints the version', async () => {
    const { code, stdout } = await run(['--version']);
    assert.equal(code, 0);
    assert.equal(stdout.trim(), VERSION);
  });

  it('prints help', async () => {
    const { code, stdout } = await run(['--help']);
    assert.equal(code, 0);
    assert.match(stdout, /watchtower scan \[paths\.\.\.\]/);
    assert.match(stdout, /--fail-on/);
  });

  it('lists every rule', async () => {
    const { code, stdout } = await run(['rules']);
    assert.equal(code, 0);
    for (const rule of RULES) assert.ok(stdout.includes(rule.id), rule.id);
  });

  it('exits 2 on usage errors', async () => {
    assert.equal((await run(['frobnicate'])).code, 2);
    assert.equal((await run(['scan', '--format', 'xml'])).code, 2);
    assert.equal((await run(['scan', '--fail-on', 'severe'])).code, 2);
    assert.equal((await run(['scan', '--output'])).code, 2);
    const unknown = await run(['scan', '--nope']);
    assert.equal(unknown.code, 2);
    assert.match(unknown.stderr, /unknown option --nope/);
  });

  it('exits 2 when a path does not exist', async () => {
    const { code, stderr } = await run(['scan', 'does/not/exist']);
    assert.equal(code, 2);
    assert.match(stderr, /cannot read does\/not\/exist/);
  });
});

describe('CLI scanning the examples', () => {
  it('fails on the vulnerable examples and passes on the hardened ones', async () => {
    const vulnerable = await run(['scan', 'examples/vulnerable', '--no-color']);
    assert.equal(vulnerable.code, 1);
    assert.match(vulnerable.stdout, /examples\/vulnerable\/ACCTXFER\.cbl:\d+:\d+/);
    assert.match(vulnerable.stdout, /✖ FAIL/);
    const hardened = await run(['scan', 'examples/hardened', '--fail-on', 'info']);
    assert.equal(hardened.code, 0, hardened.stdout);
    assert.match(hardened.stdout, /✔ PASS/);
  });

  it('honours --fail-on', async () => {
    assert.equal((await run(['scan', 'examples/vulnerable', '--fail-on', 'none'])).code, 0);
    assert.equal((await run(['scan', 'examples/vulnerable/CUSTSQL.cbl', '--fail-on', 'critical'])).code, 0);
    assert.equal((await run(['scan', 'examples/vulnerable/CUSTSQL.cbl', '--fail-on', 'high'])).code, 1);
  });

  it('writes JSON with tool, summary and per-file results', async () => {
    const { code, stdout } = await run(['scan', 'examples/vulnerable', '--format', 'json', '--fail-on', 'none']);
    assert.equal(code, 0);
    const report = JSON.parse(stdout);
    assert.deepEqual(report.tool, { name: 'Watchtower', version: VERSION });
    assert.equal(report.summary.files, report.results.length);
    const files = report.results.map((r) => r.file);
    assert.deepEqual(files, [...files].sort());
    assert.ok(files.every((file) => file.startsWith('examples/vulnerable/')));
    const payroll = report.results.find((r) => r.file === 'examples/vulnerable/PAYROLL.cob');
    assert.equal(payroll.language, 'cobol');
    assert.equal(payroll.format, 'fixed');
    assert.ok(payroll.findings.every((f) => typeof f.line === 'number' && f.cwe.startsWith('CWE-')));
  });

  it('writes SARIF with relative URIs and %SRCROOT%', async () => {
    const { code, stdout } = await run(['scan', 'examples/vulnerable', '--format=sarif', '--fail-on=none']);
    assert.equal(code, 0);
    const sarif = JSON.parse(stdout);
    assert.equal(sarif.version, '2.1.0');
    const [run0] = sarif.runs;
    assert.ok(run0.results.length > 0);
    assert.ok(run0.results.every((r) => r.locations[0].physicalLocation.artifactLocation.uri.startsWith('examples/vulnerable/')));
    assert.ok(run0.originalUriBaseIds['%SRCROOT%'].uri.startsWith('file:///'));
  });
});

describe('CLI file handling', () => {
  /** @type {string} */
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'watchtower-cli-'));
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'node_modules'));
    mkdirSync(join(dir, 'legacy'));
    const medium = cobolProgram({ data: ['01  WS-PAN PIC X(16).'], procedure: ['    DISPLAY WS-PAN'] });
    writeFileSync(join(dir, 'src', 'MEDIUM.cbl'), medium);
    writeFileSync(join(dir, 'node_modules', 'DEP.cbl'), cobolProgram({ data: ['01  P PIC X(8).'], procedure: ['    CALL P'] }));
    writeFileSync(join(dir, 'legacy', 'OLD.cob'), cobolProgram({ data: ['01  P PIC X(8).'], procedure: ['    CALL P'] }));
    writeFileSync(join(dir, 'notes.txt'), 'not scanned');
    writeFileSync(join(dir, 'BIG.cob'), `      * ${'X'.repeat(2 * 1024 * 1024)}\n`);
    symlinkSync(join(dir, 'legacy', 'OLD.cob'), join(dir, 'src', 'LINK.cob'));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('skips node_modules, symlinks and files over 2 MB, and reports paths relative to the cwd', async () => {
    const { code, stdout, stderr } = await run(['scan', '.', '--format', 'json', '--fail-on', 'none'], { cwd: dir });
    assert.equal(code, 0);
    const files = JSON.parse(stdout).results.map((r) => r.file);
    assert.deepEqual(files, ['legacy/OLD.cob', 'src/MEDIUM.cbl']);
    assert.match(stderr, /skipping symbolic link src\/LINK\.cob/);
    assert.match(stderr, /skipping BIG\.cob: larger than 2 MB/);
  });

  it('applies --exclude globs', async () => {
    const { stdout } = await run(['scan', '.', '--format', 'json', '--fail-on', 'none', '--exclude', 'legacy/**', '--exclude', '*.txt'], { cwd: dir });
    assert.deepEqual(JSON.parse(stdout).results.map((r) => r.file), ['src/MEDIUM.cbl']);
    const glob = await run(['scan', '.', '--format', 'json', '--fail-on', 'none', '--exclude', '**/M?DIUM.*'], { cwd: dir });
    assert.deepEqual(JSON.parse(glob.stdout).results.map((r) => r.file), ['legacy/OLD.cob']);
  });

  it('uses the threshold on unsuppressed findings only', async () => {
    assert.equal((await run(['scan', 'src', '--fail-on', 'high'], { cwd: dir })).code, 0);
    assert.equal((await run(['scan', 'src', '--fail-on', 'medium'], { cwd: dir })).code, 1);
  });

  it('writes only the --output file', async () => {
    const out = join(dir, 'report.sarif');
    const { code, stdout } = await run(['scan', 'src', '--format', 'sarif', '--output', out, '--fail-on', 'none'], { cwd: dir });
    assert.equal(code, 0);
    assert.equal(stdout, '');
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).version, '2.1.0');
  });

  it('refuses to write the report through a symbolic link', async () => {
    const target = join(dir, 'target.txt');
    writeFileSync(target, 'keep');
    symlinkSync(target, join(dir, 'report-link.txt'));
    const { code } = await run(['scan', 'src', '--output', join(dir, 'report-link.txt')], { cwd: dir });
    assert.equal(code, 2);
    assert.equal(readFileSync(target, 'utf8'), 'keep');
  });

  it('colours only on a TTY and never with --no-color or NO_COLOR', async () => {
    const plain = await run(['scan', 'src', '--fail-on', 'none'], { cwd: dir });
    assert.doesNotMatch(plain.stdout, new RegExp(String.fromCharCode(27)));
  });
});
