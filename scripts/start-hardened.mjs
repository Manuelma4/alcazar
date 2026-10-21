#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Start Gatehouse under the Node.js permission model: read access to the
// repository, write access to the job directory only, and permission to
// spawn the legacy programs. The master key and operator token files
// (ALCAZAR_KEY_FILE, ALCAZAR_API_TOKEN_FILE) are the only files outside both
// that Gatehouse may read — keep them out of the job directory, ideally on a
// read-only secret mount such as /run/secrets.
//
//   node scripts/start-hardened.mjs          production defaults (demo off)
//   node scripts/start-hardened.mjs --demo   the showcase: demo mode on,
//                                            unless ALCAZAR_DEMO says otherwise
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
// From Node 25 the permission model covers the network too, and Gatehouse
// must listen. Only a Node that knows the flag gets it: Node 24 refuses it.
if (process.allowedNodeEnvironmentFlags.has('--allow-net')) flags.push('--allow-net');
if (process.env.ALCAZAR_EVIDENCE_DIR) {
  // Durable evidence: created now, like the job directory, so the grant
  // covers everything below it (HARDENING.md, item 16).
  mkdirSync(process.env.ALCAZAR_EVIDENCE_DIR, { recursive: true, mode: 0o700 });
  const evidence = realpathSync(process.env.ALCAZAR_EVIDENCE_DIR);
  flags.push(`--allow-fs-read=${evidence}`, `--allow-fs-write=${evidence}`);
}

const env = { ...process.env, ALCAZAR_WORK_DIR: work };
if (process.env.ALCAZAR_EVIDENCE_DIR) env.ALCAZAR_EVIDENCE_DIR = realpathSync(process.env.ALCAZAR_EVIDENCE_DIR);
if (process.argv.includes('--demo')) env.ALCAZAR_DEMO ??= '1';
for (const name of ['ALCAZAR_KEY_FILE', 'ALCAZAR_API_TOKEN_FILE']) {
  if (!process.env[name]) continue;
  // Gatehouse gets the resolved path, so it reads exactly the file the grant
  // names (a Kubernetes secret, for one, is a chain of symbolic links).
  let file;
  try {
    file = realpathSync(process.env[name]);
  } catch (error) {
    console.error(`start-hardened: ${name}: ${error.message}`);
    process.exit(1);
  }
  flags.push(`--allow-fs-read=${file}`);
  env[name] = file;
}

const child = spawn(process.execPath, [...flags, join(root, 'gatehouse', 'src', 'server.mjs')], { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
