// SPDX-License-Identifier: Apache-2.0
// The hardened launcher from a directory whose name has an accent, spelled
// the other way (HARDENING 14): on macOS a name can be stored as e + U+0301
// (NFD) and typed as é (NFC), and the permission model compares paths byte
// for byte. Grants computed with realpathSync() match what Node opens.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ROOT } from '../src/config.mjs';
import { SKIP_REASON } from './helpers.mjs';

// What Gatehouse reads at run time, and the programs it runs.
const PARTS = ['package.json', 'scripts', 'gatehouse/src', 'lookout', 'shared', 'watchtower/src', 'rampart', 'apps', 'examples',
  'build/bin', 'build/manifest.json'];

describe('The hardened launcher from an accented path', { skip: SKIP_REASON }, () => {
  let base;
  before(async () => {
    // Created as NFD (e + combining acute), then reached as NFC.
    base = await mkdtemp(join(tmpdir(), 'alcazar-Securité-'));
    await Promise.all(PARTS.map((part) => cp(join(ROOT, part), join(base, 'repo', part), { recursive: true })));
  });
  after(() => rm(base, { recursive: true, force: true }));

  it('starts, writes its job directory and passes its self-test, whichever way the path is spelled', async () => {
    // On macOS (APFS) both spellings reach the same directory; elsewhere
    // they are two different names, and only the one created exists.
    const spellings = process.platform === 'darwin' ? [base.normalize('NFC'), base.normalize('NFD')] : [base];
    for (const spelling of spellings) {
      const child = spawn(process.execPath, [join(spelling, 'repo', 'scripts', 'start-hardened.mjs')], {
        env: { ...process.env, ALCAZAR_HOST: '127.0.0.1', ALCAZAR_PORT: '0', ALCAZAR_AUTH: 'none', ALCAZAR_WORK_DIR: join(spelling, 'work') },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const closed = new Promise((resolve) => child.on('close', resolve));
      try {
        const url = await new Promise((resolve, reject) => {
          let out = '';
          let err = '';
          child.stdout.on('data', (chunk) => {
            out += chunk;
            const line = out.split('\n').find((l) => l.includes('"Gatehouse listening"'));
            if (line) resolve(JSON.parse(line).url);
          });
          child.stderr.on('data', (chunk) => { err += chunk; });
          closed.then((code) => reject(new Error(`the launcher exited with ${code}: ${err}`)));
        });
        const health = await (await fetch(`${url}api/health`)).json();
        assert.equal(health.selftest.status, 'pass', `${spelling === spelling.normalize('NFC') ? 'NFC' : 'NFD'}: ${JSON.stringify(health.selftest)}`);
      } finally {
        child.kill('SIGTERM');
        await closed;
      }
    }
  });
});
