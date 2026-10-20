#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// What an auditor needs from Gatehouse's master key, and nothing more:
// K_ledger, to recompute the chain, and the anchor public key, to check the
// anchors Gatehouse signed. Neither yields the master key, K_token or the
// anchor-signing key.
//
//   node scripts/audit-keys.mjs --master-key-file FILE --out DIR
//
// Writes DIR/K_LEDGER.key (mode 0600) and DIR/ANCHOR.pub (base64url), and
// never overwrites either. Then:
//   node scripts/verify-ledger.mjs <evidence>/<job> <job> --ledger-key-file DIR/K_LEDGER.key \
//        --anchor <evidence>/<job>/ANCHOR.json --anchor-key "$(cat DIR/ANCHOR.pub)"

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { anchorSigner } from '../gatehouse/src/anchor.mjs';
import { deriveKeys, keyFromHex, keyLines } from '../gatehouse/src/ledger.mjs';

function usage(message) {
  if (message) console.error(`audit-keys: ${message}`);
  console.error('usage: node scripts/audit-keys.mjs --master-key-file FILE --out DIR');
  process.exit(2);
}

const argv = process.argv.slice(2);
const option = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const file = option('--master-key-file');
const out = option('--out');
if (!file || !out || argv.length !== 4) usage();

let info;
try {
  info = statSync(file);
} catch {
  usage(`cannot read ${file}`);
}
if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) usage(`${file} must not be accessible by group or others (chmod 600)`);

// Bytes from start to finish, wiped as soon as they are used.
const raw = readFileSync(file);
let end = raw.length;
while (end > 0 && (raw[end - 1] === 0x0a || raw[end - 1] === 0x0d)) end -= 1;
const master = keyFromHex(raw.subarray(0, end));
raw.fill(0);
if (!master) usage(`${file} must contain the master key as 64 lower-case hex digits`);
const keys = deriveKeys(master);
const signer = anchorSigner(master);
master.fill(0);
keys.token.fill(0);

const ledgerKey = keyLines(keys.ledger);
keys.ledger.fill(0);
let failure = null;
try {
  mkdirSync(out, { recursive: true, mode: 0o700 });
  writeFileSync(join(out, 'K_LEDGER.key'), ledgerKey, { mode: 0o600, flag: 'wx' });
  writeFileSync(join(out, 'ANCHOR.pub'), `${signer.publicKey}\n`, { mode: 0o644, flag: 'wx' });
} catch (error) {
  failure = error;
} finally {
  ledgerKey.fill(0);
}
if (failure) usage(failure.code === 'EEXIST' ? `${failure.path} already exists: audit keys are never overwritten` : failure.message);
console.log(`K_LEDGER.key and ANCHOR.pub (anchor key ${signer.keyId}) written to ${out}`);
