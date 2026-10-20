#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Verify a sealed job outside Gatehouse, as an auditor would: with K_ledger
// only (never the master key, never K_token), with both verifiers — the
// independent Node.js / OpenSSL one and, when it is built, LEDGERCK — and,
// if the anchor is known, against it.
//
//   node scripts/verify-ledger.mjs <job-dir> <job-id> --ledger-key-file FILE
//                                  [--entries N --head HEX]
//
// FILE holds K_ledger as 64 lower-case hex digits (mode 0600 or stricter).
// Exit code: 0 the ledger and the records it seals are intact, 4 broken,
// 8 the two verifiers disagree, 2 usage or key-file error.

import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyFromHex, keyLines, verifyLedger } from '../gatehouse/src/ledger.mjs';
import { parseLedgerck } from '../gatehouse/src/records.mjs';
import { runLegacy } from '../gatehouse/src/runner.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LEDGERCK = join(ROOT, 'build', 'bin', 'ledgerck');

function usage(message) {
  if (message) console.error(`verify-ledger: ${message}`);
  console.error('usage: node scripts/verify-ledger.mjs <job-dir> <job-id> --ledger-key-file FILE [--entries N --head HEX]');
  process.exit(2);
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (i + 1 >= argv.length) usage(`${arg} needs a value`);
      options[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) usage();
  const [dir, job] = positional;
  if (!/^[a-z0-9-]{1,32}$/.test(job)) usage('the job id is 1-32 characters from a-z 0-9 -');
  if (!options['ledger-key-file']) usage('--ledger-key-file is required');
  if ((options.entries === undefined) !== (options.head === undefined)) usage('--entries and --head go together');
  if (options.entries !== undefined && (!/^\d{1,6}$/.test(options.entries) || !/^[0-9a-f]{64}$/.test(options.head))) {
    usage('--entries is a count, --head 64 lower-case hex digits');
  }
  return { dir, job, keyFile: options['ledger-key-file'], anchor: options.entries === undefined ? null : { entries: Number(options.entries), head: options.head } };
}

/** K_ledger from its file, as bytes from start to finish. */
async function readLedgerKey(file) {
  const info = await stat(file).catch(() => usage(`cannot read ${file}`));
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) usage(`${file} must not be accessible by group or others (chmod 600)`);
  const raw = await readFile(file);
  try {
    let end = raw.length;
    while (end > 0 && (raw[end - 1] === 0x0a || raw[end - 1] === 0x0d)) end -= 1;
    const key = keyFromHex(raw.subarray(0, end));
    if (!key) usage(`${file} must contain K_ledger as 64 lower-case hex digits`);
    return key;
  } finally {
    raw.fill(0);
  }
}

async function readJobFile(dir, name) {
  try {
    return await readFile(join(dir, name), 'latin1');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

const describe = (v) => (v.valid ? `OK, ${v.entries} entries, head ${v.head}` : `BROKEN at entry ${v.brokenAt}: ${v.reason} (${v.entries} verified before it)`);

const { dir, job, keyFile, anchor } = parseArgs(process.argv.slice(2));
const key = await readLedgerKey(keyFile);
const files = { ledger: await readJobFile(dir, 'LEDGER.DAT'), accepted: await readJobFile(dir, 'ACCEPTED.DAT'), rejected: await readJobFile(dir, 'REJECTED.DAT') };
const node = verifyLedger(files.ledger, key, job, files);
console.log(`node-openssl   ${describe(node)}`);

let cobol = null;
if (existsSync(LEDGERCK)) {
  const stdin = keyLines(key);
  try {
    const result = await runLegacy(LEDGERCK, [job], { cwd: dir, stdin, timeoutMs: 30_000, maxOutputBytes: 65_536 });
    if (result.code !== 0 && result.code !== 4) {
      console.error(`verify-ledger: LEDGERCK failed (return code ${result.code}): ${result.stderr.trim()}`);
      process.exitCode = 8;
    } else {
      cobol = parseLedgerck(result.stdout);
      console.log(`cobol-fortran  ${describe(cobol)}`);
    }
  } finally {
    stdin.fill(0);
  }
} else {
  console.log('cobol-fortran  not built (run make): Node verdict only');
}
key.fill(0);

if (process.exitCode !== 8) {
  const agree = !cobol || (cobol.valid === node.valid && cobol.entries === node.entries && cobol.brokenAt === node.brokenAt &&
    cobol.reason === node.reason && cobol.head === node.head);
  if (!agree) {
    console.log('verdict        the verifiers DISAGREE: treat the ledger as broken');
    process.exitCode = 8;
  } else if (!node.valid) {
    console.log('verdict        BROKEN');
    process.exitCode = 4;
  } else if (anchor && (anchor.entries !== node.entries || anchor.head !== node.head)) {
    console.log(`verdict        BROKEN: HEAD-MISMATCH, the anchor says ${anchor.entries} entries ending in ${anchor.head}`);
    process.exitCode = 4;
  } else {
    console.log(`verdict        INTACT${anchor ? ', and matches the anchor' : ' (no anchor given: truncation cannot be ruled out)'}`);
    process.exitCode = 0;
  }
}
