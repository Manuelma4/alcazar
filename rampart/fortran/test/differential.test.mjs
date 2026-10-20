// SPDX-License-Identifier: Apache-2.0
// Differential test: the Fortran SHA-256 / HMAC-SHA256 kernel against
// OpenSSL (node:crypto) on thousands of reproducible random inputs, with the
// padding and key-size boundaries over-represented.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TOOL = join(ROOT, 'build', 'bin', 'alzhmac');
const SKIP = existsSync(TOOL) ? false : 'build/bin/alzhmac not built (run `make`)';

/** mulberry32 — reproducible, not cryptographic. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Message lengths around the 55/56/64-byte SHA-256 padding edges, and key
// lengths around the 64-byte HMAC block (longer keys are hashed first).
const MESSAGE_EDGES = [0, 1, 54, 55, 56, 57, 63, 64, 65, 111, 112, 119, 120, 127, 128, 129, 191, 192, 1000];
const KEY_EDGES = [0, 1, 16, 31, 32, 33, 63, 64, 65, 127, 128, 129, 200];

function bytes(rand, n) {
  const out = Buffer.alloc(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.floor(rand() * 256);
  return out;
}

function cases(seed, count) {
  const rand = prng(seed);
  const pick = (edges, max) => (rand() < 0.5 ? edges[Math.floor(rand() * edges.length)] : Math.floor(rand() * max));
  return Array.from({ length: count }, () => {
    const message = bytes(rand, pick(MESSAGE_EDGES, 3000));
    return rand() < 0.3 ? { message } : { key: bytes(rand, pick(KEY_EDGES, 300)), message };
  });
}

function runKernel(list) {
  const input = list.map((c) => (c.key ? `H ${c.key.toString('hex')} ${c.message.toString('hex')}` : `S ${c.message.toString('hex')}`));
  const result = spawnSync(TOOL, { input: `${input.join('\n')}\n`, maxBuffer: 64 * 1024 * 1024, env: {} });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout.toString().trim().split('\n');
}

describe('Fortran kernel vs OpenSSL', { skip: SKIP }, () => {
  for (const seed of [1, 2, 3, 4]) {
    it(`agrees on 1,000 random SHA-256 / HMAC cases (seed ${seed})`, () => {
      const list = cases(seed, 1000);
      const got = runKernel(list);
      assert.equal(got.length, list.length);
      list.forEach((c, i) => {
        const want = c.key
          ? createHmac('sha256', c.key).update(c.message).digest('hex')
          : createHash('sha256').update(c.message).digest('hex');
        assert.equal(got[i], want, `case ${i}: key ${c.key?.length ?? '-'} bytes, message ${c.message.length} bytes`);
      });
    });
  }

  it('rejects malformed input instead of guessing', () => {
    for (const bad of ['S 0', 'S zz', 'H 00', 'X 00', 'H 0g 00']) {
      const result = spawnSync(TOOL, { input: `${bad}\n`, env: {} });
      assert.equal(result.status, 2, bad);
    }
  });
});
