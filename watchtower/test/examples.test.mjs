import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RULES, scan } from '../src/index.mjs';
import { copybookResolver } from '../src/node/files.mjs';

const EXAMPLES = fileURLToPath(new URL('../../examples/', import.meta.url));
const NOT_COMPILABLE = new Set(['CUSTSQL.cbl', 'trojan_source.cob']); // SQL precompiler / intentional Trojan Source

/**
 * @param {string} group 'vulnerable' | 'hardened'
 */
function scanGroup(group) {
  const dir = join(EXAMPLES, group);
  return readdirSync(dir).filter((name) => /\.(cob|cbl|cpy|f|f90)$/.test(name)).sort().map((name) => {
    const path = join(dir, name);
    return { name, path, ...scan(readFileSync(path, 'utf8'), { filename: name, resolveCopybook: copybookResolver(path) }) };
  });
}

/** @param {string} tool */
function available(tool) {
  return spawnSync(tool, ['--version'], { stdio: 'ignore' }).status === 0;
}

describe('vulnerable examples', () => {
  const results = scanGroup('vulnerable');

  it('contain the required demo programs', () => {
    const names = results.map((r) => r.name);
    for (const required of ['PAYROLL.cob', 'ACCTXFER.cbl', 'CUSTSQL.cbl', 'loancalc.f', 'risk_engine.f90', 'trojan_source.cob']) {
      assert.ok(names.includes(required), required);
    }
  });

  it('trigger every rule at least once', () => {
    const fired = new Set(results.flatMap((r) => r.findings.map((f) => f.ruleId)));
    const missing = RULES.map((rule) => rule.id).filter((id) => !fired.has(id));
    assert.deepEqual(missing, []);
  });

  it('carry a loud intentionally-vulnerable header', () => {
    for (const result of results) {
      if (result.name.endsWith('.cpy')) continue;
      const head = readFileSync(result.path, 'utf8').split('\n').slice(0, 12).join('\n').toUpperCase();
      assert.ok(head.includes('INTENTIONALLY VULNERABLE') || head.includes('INTENTIONALLY MALICIOUS'), result.name);
    }
  });

  it('contain a real bidi override only in trojan_source.cob', () => {
    const rlo = String.fromCodePoint(0x202e);
    for (const result of results) {
      assert.equal(readFileSync(result.path, 'utf8').includes(rlo), result.name === 'trojan_source.cob', result.name);
    }
  });
});

describe('hardened examples', () => {
  const results = scanGroup('hardened');

  it('cover the vulnerable counterparts', () => {
    const names = results.map((r) => r.name);
    for (const required of ['PAYROLL.cob', 'ACCTXFER.cbl', 'loancalc.f', 'risk_engine.f90']) assert.ok(names.includes(required), required);
  });

  it('produce zero findings', () => {
    for (const result of results) assert.deepEqual(result.findings.map((f) => `${f.ruleId}:${f.line}`), [], result.name);
  });

  it('only suppress with a justification', () => {
    for (const result of results) {
      for (const finding of result.suppressed) assert.ok(finding.suppression.justification.length > 10, result.name);
    }
  });
});

describe('examples compile', () => {
  const groups = ['vulnerable', 'hardened'];
  const cobolFiles = [];
  const fortranFiles = [];
  for (const group of groups) {
    for (const name of readdirSync(join(EXAMPLES, group)).sort()) {
      if (NOT_COMPILABLE.has(name)) continue;
      if (/\.(cob|cbl)$/i.test(name)) cobolFiles.push({ group, name });
      else if (/\.(f|f90)$/i.test(name)) fortranFiles.push({ group, name });
    }
  }

  it('pass cobc -fsyntax-only', { skip: !available('cobc') && 'cobc not installed' }, () => {
    for (const { group, name } of cobolFiles) {
      const dir = join(EXAMPLES, group);
      const free = readFileSync(join(dir, name), 'utf8').includes('>>SOURCE FORMAT IS FREE');
      execFileSync('cobc', ['-fsyntax-only', ...(free ? ['-free'] : []), '-I', dir, join(dir, name)], { stdio: 'pipe' });
    }
  });

  it('pass gfortran -fsyntax-only', { skip: !available('gfortran') && 'gfortran not installed' }, () => {
    const modules = mkdtempSync(join(tmpdir(), 'watchtower-mod-'));
    try {
      for (const { group, name } of fortranFiles) {
        const form = name.toLowerCase().endsWith('.f') ? ['-ffixed-form'] : [];
        execFileSync('gfortran', ['-fsyntax-only', ...form, '-J', modules, join(EXAMPLES, group, name)], { stdio: 'pipe', cwd: modules });
      }
    } finally {
      rmSync(modules, { recursive: true, force: true });
    }
  });
});
