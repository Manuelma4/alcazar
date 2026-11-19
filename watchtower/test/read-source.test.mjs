import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readSourceFile } from '../src/node/files.mjs';
import { scan } from '../src/index.mjs';

it('handles byte-order marks identically in direct scans and file input', () => {
  const folder = fs.mkdtempSync(join(tmpdir(), 'watchtower-bom-'));
  try {
    const source = join(folder, 'INPUT.txt');
    const cli = fileURLToPath(new URL('../bin/watchtower.mjs', import.meta.url));
    const bom = String.fromCodePoint(0xfeff);
    const findings = (result) => result.findings.filter((f) => f.ruleId === 'ALZ-GEN-002');
    for (const content of ['hello\n', `${bom}hello\n`, `${bom}${bom}hello\n`,
      `${bom}${bom}${bom}hello\n`, `he${bom}llo\n`]) {
      fs.writeFileSync(source, content);
      const expected = findings(scan(content, { filename: 'INPUT.txt' }));
      assert.deepEqual(findings(scan(readSourceFile(source), { filename: 'INPUT.txt' })), expected);
      const result = spawnSync(process.execPath, [cli, 'scan', 'INPUT.txt', '--format', 'json'],
        { cwd: folder, encoding: 'utf8' });
      assert.ok(result.status === 0 || result.status === 1, result.stderr);
      assert.deepEqual(findings(JSON.parse(result.stdout).results[0]), expected);
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

it('preserves a report when a source is truncated during the read', () => {
  const folder = fs.mkdtempSync(join(tmpdir(), 'watchtower-truncate-'));
  try {
    const source = join(folder, 'INPUT.cbl');
    const report = join(folder, 'report.json');
    fs.writeFileSync(source, '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. SAMPLE.\n');
    fs.writeFileSync(report, 'previous report\n');
    const cli = fileURLToPath(new URL('../bin/watchtower.mjs', import.meta.url));
    const script = `
      const fs = require('node:fs');
      const { syncBuiltinESMExports } = require('node:module');
      const { pathToFileURL } = require('node:url');
      const [source, report, cli] = process.argv.slice(1);
      const inode = fs.statSync(source).ino;
      const read = fs.readSync;
      let shortened = false;
      fs.readSync = function(fd, buffer, offset, length, position) {
        if (!shortened && fs.fstatSync(fd).ino === inode) {
          const count = read(fd, buffer, offset, Math.min(length, 8), position);
          fs.truncateSync(source, count);
          shortened = true;
          return count;
        }
        return read(fd, buffer, offset, length, position);
      };
      syncBuiltinESMExports();
      process.argv = [process.execPath, cli, 'scan', source, '--format', 'json', '--output', report];
      import(pathToFileURL(cli).href);
    `;
    let failure;
    try {
      execFileSync(process.execPath, ['-e', script, source, report, cli], { stdio: 'pipe' });
    } catch (error) {
      failure = error;
    }
    assert.equal(failure?.status, 2);
    assert.match(failure.stderr.toString(), /source ended before the expected size/);
    assert.equal(fs.readFileSync(report, 'utf8'), 'previous report\n');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

it('accepts empty sources and reads short chunks to completion', () => {
  const folder = fs.mkdtempSync(join(tmpdir(), 'watchtower-chunks-'));
  const originalRead = fs.default.readSync;
  try {
    const source = join(folder, 'INPUT.cbl');
    fs.writeFileSync(source, '');
    assert.equal(readSourceFile(source), '');
    const content = '       IDENTIFICATION DIVISION.\n';
    fs.writeFileSync(source, content);
    fs.default.readSync = (fd, buffer, offset, length, position) =>
      originalRead(fd, buffer, offset, Math.min(length, 3), position);
    syncBuiltinESMExports();
    assert.equal(readSourceFile(source), content);
  } finally {
    fs.default.readSync = originalRead;
    syncBuiltinESMExports();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
