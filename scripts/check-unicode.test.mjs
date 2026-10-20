// SPDX-License-Identifier: Apache-2.0
// The Trojan Source guard: every bidi control and every invisible character,
// in any text file but the one intentional sample.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./check-unicode.mjs', import.meta.url));
// Bidi marks, embeddings, overrides and isolates; zero-width characters, the
// soft hyphen, a Hangul filler, a variation selector and a tag character.
const CODES = [0x061c, 0x200e, 0x200f, 0x202a, 0x202e, 0x2066, 0x2069, 0x200b, 0x200d, 0x2060, 0x00ad, 0x3164, 0xfe0f, 0xe0041, 0xfeff];

describe('check-unicode', () => {
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'alcazar-unicode-'));
  });
  after(() => rm(dir, { recursive: true, force: true }));
  const check = () => spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' });

  it('passes clean text, accents and emoji included', async () => {
    await writeFile(join(dir, 'clean.md'), 'Alcázar — Sevilla, déjà vu, 東京, \u{1F3F0}\n');
    assert.equal(check().status, 0);
  });

  it('reports each hidden character with its position, and fails', async () => {
    await mkdir(join(dir, 'src'), { recursive: true });
    for (const code of CODES) await writeFile(join(dir, 'src', `u${code.toString(16)}.mjs`), `const x = 'a${String.fromCodePoint(code)}b';\n`);
    const result = check();
    assert.equal(result.status, 1);
    for (const code of CODES) {
      const hex = code.toString(16).toUpperCase().padStart(4, '0');
      assert.match(result.stderr, new RegExp(`src/u${code.toString(16)}\\.mjs:1:13: U\\+${hex} `), hex);
    }
    await rm(join(dir, 'src'), { recursive: true });
  });

  it('exempts only the intentional Watchtower sample', async () => {
    await mkdir(join(dir, 'examples', 'vulnerable'), { recursive: true });
    await writeFile(join(dir, 'examples', 'vulnerable', 'trojan_source.cob'), `* ${String.fromCodePoint(0x202e)}\n`);
    assert.equal(check().status, 0);
    await writeFile(join(dir, 'examples', 'vulnerable', 'other.cob'), `* ${String.fromCodePoint(0x202e)}\n`);
    assert.equal(check().status, 1);
  });
});
