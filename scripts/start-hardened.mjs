#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Start Gatehouse under the Node.js permission model: read access to the
// repository, write access to the job directory only, and permission to
// spawn the legacy programs. A master key file (ALCAZAR_KEY_FILE) is the one
// file outside both that Gatehouse may read — keep it out of the job
// directory, ideally on a read-only secret mount such as /run/secrets.
//
// The allowed paths are computed the way Node itself spells them. The
// permission model compares paths exactly, and on macOS a directory name
// with accents can reach Node in NFD form (e + combining accent) while the
// shell's $PWD holds the NFC form — `--allow-fs-read="$PWD"` then silently
// fails to match.

import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
const workDir = process.env.ALCAZAR_WORK_DIR ?? join(root, 'var', 'jobs');
mkdirSync(workDir, { recursive: true, mode: 0o700 });
const work = realpathSync(workDir);

const flags = [
  '--permission',
  `--allow-fs-read=${root}`,
  `--allow-fs-read=${work}`,
  `--allow-fs-write=${work}`,
  '--allow-child-process',
];
if (process.platform === 'linux') flags.push('--allow-fs-read=/usr/bin/prlimit');

const env = { ...process.env, ALCAZAR_WORK_DIR: work };
if (process.env.ALCAZAR_KEY_FILE) {
  // Gatehouse gets the resolved path, so it reads exactly the file the grant
  // names (a Kubernetes secret, for one, is a chain of symbolic links).
  let keyFile;
  try {
    keyFile = realpathSync(process.env.ALCAZAR_KEY_FILE);
  } catch (error) {
    console.error(`start-hardened: ALCAZAR_KEY_FILE: ${error.message}`);
    process.exit(1);
  }
  flags.push(`--allow-fs-read=${keyFile}`);
  env.ALCAZAR_KEY_FILE = keyFile;
}

const child = spawn(process.execPath, [...flags, join(root, 'gatehouse', 'src', 'server.mjs')], { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
