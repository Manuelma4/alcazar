#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Verify a sealed job outside Gatehouse, as an auditor would: with K_ledger
// only (never the master key, never K_token), with both verifiers — the
// independent Node.js / OpenSSL one and, when it is built, LEDGERCK — and
// against the job's anchor.
//
//   node scripts/verify-ledger.mjs <job-dir> <job-id> --ledger-key-file FILE
//        [--anchor ANCHOR.json --anchor-key KEY | --entries N --head HEX]
//
// FILE holds K_ledger as 64 lower-case hex digits (mode 0600 or stricter).
// ANCHOR.json is the anchor Gatehouse signed when it sealed the job (from
// the evidence directory, or GET /api/jobs/<id>/anchor); KEY is Gatehouse's
// public key, from /api/health or scripts/audit-keys.mjs — taken from you,
// never from the anchor. K_ledger alone cannot forge a signed anchor.
//
// Exit code: 0 intact and matching the anchor; 3 the chain is intact but
// no anchor was given, so a truncated ledger — or another job's complete
// files — cannot be ruled out; 4 broken (an empty ledger, or an anchor that
// is not authentic, included); 8 the two verifiers disagree; 2 usage or
// key-file error.

import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnchorError, verifyAnchor } from '../gatehouse/src/anchor.mjs';
import { keyFromHex, keyLines, verifyLedger } from '../gatehouse/src/ledger.mjs';
import { parseLedgerck } from '../gatehouse/src/records.mjs';
import { runLegacy } from '../gatehouse/src/runner.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LEDGERCK = join(ROOT, 'build', 'bin', 'ledgerck');

function usage(message) {
  if (message) console.error(`verify-ledger: ${message}`);
  console.error('usage: node scripts/verify-ledger.mjs <job-dir> <job-id> --ledger-key-file FILE');
  console.error('         [--anchor ANCHOR.json --anchor-key KEY | --entries N --head HEX]');
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
  if ((options.anchor === undefined) !== (options['anchor-key'] === undefined)) {
    usage("--anchor and --anchor-key go together: the key is Gatehouse's public key, from you, never from the anchor");
  }
  if (options.entries !== undefined && options.anchor !== undefined) usage('give --anchor or --entries/--head, not both');
  if (options.entries !== undefined && (!/^\d{1,6}$/.test(options.entries) || !/^[0-9a-f]{64}$/.test(options.head))) {
    usage('--entries is a count, --head 64 lower-case hex digits');
  }
  return {
    dir,
    job,
    keyFile: options['ledger-key-file'],
    anchor: options.entries === undefined ? null : { entries: Number(options.entries), head: options.head },
    signed: options.anchor === undefined ? null : { file: options.anchor, key: options['anchor-key'] },
  };
}

/** A signed anchor, checked against the key the auditor brought, for this job. */
async function readSignedAnchor({ file, key }, job) {
  let doc;
  try {
    doc = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    usage(`cannot read ${file} as JSON`);
  }
  try {
    const anchor = verifyAnchor(doc, key);
    if (anchor.job !== job) throw new AnchorError(`it anchors job ${anchor.job}, not ${job}`);
    return anchor;
  } catch (error) {
    if (!(error instanceof AnchorError)) throw error;
    console.log(`anchor         NOT AUTHENTIC: ${error.message}`);
    console.log('verdict        BROKEN: the anchor cannot be trusted');
    process.exit(4);
  }
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

const { dir, job, keyFile, anchor: given, signed } = parseArgs(process.argv.slice(2));
const anchor = signed ? await readSignedAnchor(signed, job) : given;
if (signed) console.log(`anchor         signed by key ${anchor.keyId} at ${anchor.sealedAt}: ${anchor.entries} entries, head ${anchor.head}`);
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
  } else if (node.entries === 0) {
    console.log('verdict        BROKEN: no ledger entries — a sealed job has at least one');
    process.exitCode = 4;
  } else if (anchor && (anchor.entries !== node.entries || anchor.head !== node.head)) {
    console.log(`verdict        BROKEN: HEAD-MISMATCH, the anchor says ${anchor.entries} entries ending in ${anchor.head}`);
    process.exitCode = 4;
  } else if (anchor) {
    console.log(`verdict        INTACT, and matches the ${signed ? 'signed ' : ''}anchor`);
    process.exitCode = 0;
  } else {
    console.log('verdict        UNANCHORED: the chain is intact, but without an anchor a truncated ledger — or another');
    console.log("               job's complete files — cannot be ruled out (give --anchor and --anchor-key)");
    process.exitCode = 3;
  }
}
