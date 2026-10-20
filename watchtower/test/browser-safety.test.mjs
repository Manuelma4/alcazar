/**
 * Everything under src/ (except src/node/) must run in a browser: no Node.js
 * modules, no process / Buffer / require, no eval or new Function.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * @param {string} dir
 * @returns {string[]}
 */
function moduleFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node' ? [] : moduleFiles(path);
    return name.endsWith('.mjs') ? [path] : [];
  });
}

const FORBIDDEN = [
  [/from\s+['"]node:/, 'node: import'],
  [/import\s*\(\s*['"]node:/, 'dynamic node: import'],
  [/from\s+['"](fs|path|os|child_process|url|process)['"]/, 'bare Node.js module import'],
  [/\brequire\s*\(/, 'require()'],
  [/\bprocess\./, 'process'],
  [/\bBuffer\b/, 'Buffer'],
  [/\beval\s*\(/, 'eval'],
  [/new\s+Function\s*\(/, 'new Function'],
  [/from\s+['"][^'"]*\/node\//, 'import of src/node/'],
];

describe('browser safety', () => {
  const files = moduleFiles(SRC);

  it('finds the browser modules', () => {
    assert.ok(files.length >= 15);
  });

  for (const file of files) {
    it(`${relative(SRC, file)} uses no Node.js APIs`, () => {
      const text = readFileSync(file, 'utf8');
      for (const [pattern, what] of FORBIDDEN) assert.doesNotMatch(text, pattern, `${what} in ${relative(SRC, file)}`);
    });
  }

  it('loads the public API with exactly the documented names', async () => {
    const api = await import('../src/index.mjs');
    for (const name of ['VERSION', 'RULES', 'scan', 'detectLanguage', 'toSarif', 'formatText', 'summarize']) {
      assert.ok(name in api, name);
    }
    assert.equal(api.VERSION, '0.1.0');
    assert.ok(Object.isFrozen(api.RULES));
    for (const rule of api.RULES) {
      assert.deepEqual(Object.keys(rule).sort(),
        ['cwe', 'docs', 'fix', 'id', 'language', 'name', 'precision', 'rationale', 'severity', 'summary', 'title']);
      assert.equal(rule.docs, `docs/rules/${rule.id}.md`);
    }
  });
});
