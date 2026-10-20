#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Benchmarks for docs/BENCHMARKS.md. Requires `make` to have built the core.
//
//   node scripts/bench.mjs
//
// Measures the batch programs on full 1,000-record batches, Gatehouse end
// to end, the Fortran SHA-256 kernel against OpenSSL — with and without the
// run-time checks Alcazar ships with — and Watchtower's scanning speed.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../gatehouse/src/app.mjs';
import { ROOT, loadConfig } from '../gatehouse/src/config.mjs';
import { txnInFile } from '../gatehouse/src/records.mjs';
import { sampleBatch } from '../gatehouse/src/sample.mjs';
import { validateBatch } from '../gatehouse/src/schema.mjs';
import { scan } from '../watchtower/src/index.mjs';

const BIN = join(ROOT, 'build', 'bin');
// K-ledger and K-token, as Gatehouse sends them (LEDGERCK reads only the first).
const KEY = `${'a1'.repeat(32)}\n${'b2'.repeat(32)}\n`;
const work = mkdtempSync(join(tmpdir(), 'alcazar-bench-'));
const rows = [];

function stats(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { p50: at(0.5), p95: at(0.95), min: s[0] };
}

function time(fn) {
  const started = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - started) / 1e6;
}

function report(name, samples, unit, perRun) {
  const { p50, p95 } = stats(samples);
  const rate = perRun ? `${Math.round((perRun / p50) * 1000).toLocaleString('en-US')} ${unit}/s` : '';
  rows.push(`| ${name} | ${p50.toFixed(1)} ms | ${p95.toFixed(1)} ms | ${rate} |`);
}

function run(file, args, cwd, input = '') {
  const result = spawnSync(file, args, { cwd, input, env: { PATH: '/usr/bin:/bin' } });
  if (result.status !== 0 && result.status !== 4) throw new Error(`${file} exited ${result.status}: ${result.stderr}`);
}

// 1. The batch programs on a full 1,000-record batch.
const { transactions } = sampleBatch({ size: 1000, seed: 7 });
const batch = validateBatch({ transactions }, 1000);
const input = join(work, 'TXNIN.SRC');
writeFileSync(input, txnInFile(batch));
const guard = [];
for (let i = 0; i < 30; i += 1) {
  copyFileSync(input, join(work, 'TXNIN.DAT'));
  guard.push(time(() => run(join(BIN, 'txnguard'), ['j-bench'], work, KEY)));
}
report('TXNGUARD — validate, tokenise, mask and seal 1,000 records (COBOL + Fortran HMAC)', guard, 'records', 1000);

// The same program without GnuCOBOL's run-time checks (-debug), to price them.
const unchecked = join(work, 'txnguard-nodebug');
const gfortranLib = execFileSync('gfortran', [`-print-file-name=libgfortran.${process.platform === 'darwin' ? 'dylib' : 'so'}`]).toString().trim();
// Every Rampart module, so the list cannot fall behind the Makefile's.
const cobolDir = join(ROOT, 'rampart', 'cobol', 'src');
const cobolSources = readdirSync(cobolDir).filter((f) => f.endsWith('.cob')).sort().map((f) => join(cobolDir, f));
execFileSync('cobc', ['-x', '-O2', '-fstatic-call', '-I', join(ROOT, 'rampart', 'cobol', 'copybooks'), '-o', unchecked,
  join(ROOT, 'apps', 'txnguard', 'TXNGUARD.cob'), ...cobolSources, join(ROOT, 'build', 'lib', 'librampart_f.a'),
  `-L${join(gfortranLib, '..')}`, '-lgfortran'], { cwd: work });
const fastGuard = [];
for (let i = 0; i < 30; i += 1) {
  copyFileSync(input, join(work, 'TXNIN.DAT'));
  fastGuard.push(time(() => run(unchecked, ['j-bench'], work, KEY)));
}
report('TXNGUARD — same program built without `-debug` run-time checks', fastGuard, 'records', 1000);
const scanTimes = [];
for (let i = 0; i < 30; i += 1) scanTimes.push(time(() => run(join(BIN, 'fraudscan'), ['ACCEPTED.DAT', 'RISK.JSON'], work)));
report('FRAUDSCAN — score the accepted transfers (Fortran)', scanTimes, 'records', JSON.parse(readFileSync(join(work, 'RISK.JSON'), 'utf8')).n);
const check = [];
for (let i = 0; i < 30; i += 1) check.push(time(() => run(join(BIN, 'ledgerck'), ['j-bench'], work, KEY)));
report('LEDGERCK — verify a 1,000-entry ledger and the records it seals (COBOL + Fortran)', check, 'entries', 1000);

// 2. Gatehouse end to end (HTTP, validation, all programs, double verification).
const config = loadConfig({ ALCAZAR_PORT: '0', ALCAZAR_WORK_DIR: join(work, 'jobs'), ALCAZAR_RATE_CAPACITY: '100000', ALCAZAR_RATE_REFILL: '100000' });
const app = await createApp(config, { log: () => {} });
const { port } = await app.listen();
const body = JSON.stringify({ transactions });
const http = [];
for (let i = 0; i < 20; i += 1) {
  const started = process.hrtime.bigint();
  const res = await fetch(`http://127.0.0.1:${port}/api/batch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  await res.arrayBuffer();
  if (res.status !== 200) throw new Error(`batch returned ${res.status}`);
  http.push(Number(process.hrtime.bigint() - started) / 1e6);
}
await app.close();
report('Gatehouse POST /api/batch — 1,000 transfers end to end', http, 'transfers', 1000);

// 3. SHA-256 throughput: the Fortran kernel as shipped (run-time checks on),
//    the same code without checks, and OpenSSL.
const blob = join(work, 'blob.bin');
writeFileSync(blob, Buffer.alloc(64 * 1024 * 1024, 0x5a));
const fast = join(work, 'fast');
const sources = ['bytes', 'sha256'].map((m) => join(ROOT, 'rampart', 'fortran', 'src', `rampart_${m}.f90`));
execFileSync('gfortran', ['-O3', '-std=f2018', `-J${work}`, ...sources, join(ROOT, 'rampart', 'fortran', 'tools', 'alzsum.f90'), '-o', fast]);
const mib = 64;
const hash = (label, file, args) => {
  const samples = [];
  for (let i = 0; i < 5; i += 1) samples.push(time(() => execFileSync(file, args, { stdio: 'ignore' })));
  const { p50 } = stats(samples);
  rows.push(`| ${label} | ${p50.toFixed(0)} ms | | ${((mib / p50) * 1000).toFixed(0)} MiB/s |`);
};
rows.push('| | | | |');
hash('SHA-256 of 64 MiB — Fortran kernel as shipped (`-O2 -fcheck=bounds,…`)', join(BIN, 'alzsum'), [blob]);
hash('SHA-256 of 64 MiB — same Fortran, `-O3`, no run-time checks', fast, [blob]);
hash('SHA-256 of 64 MiB — OpenSSL (`openssl dgst -sha256`)', 'openssl', ['dgst', '-sha256', blob]);

// 4. Watchtower on large sources.
const cobol = readFileSync(join(ROOT, 'examples', 'vulnerable', 'ACCTXFER.cbl'), 'utf8');
const fortran = readFileSync(join(ROOT, 'examples', 'vulnerable', 'risk_engine.f90'), 'utf8');
rows.push('| | | | |');
for (const [label, text, filename] of [['COBOL', cobol, 'big.cbl'], ['Fortran', fortran, 'big.f90']]) {
  const big = text.repeat(Math.ceil(100000 / text.split('\n').length));
  const lines = big.split('\n').length;
  const samples = [];
  for (let i = 0; i < 5; i += 1) samples.push(time(() => scan(big, { filename })));
  report(`Watchtower — scan ${lines.toLocaleString('en-US')} lines of ${label}`, samples, 'lines', lines);
}

rmSync(work, { recursive: true, force: true });
console.log(`Machine: ${cpus()[0].model}, ${cpus().length} cores, ${Math.round(totalmem() / 2 ** 30)} GiB, Node ${process.version}`);
console.log('');
console.log('| Benchmark | Median | p95 | Throughput |');
console.log('|-----------|-------:|----:|-----------:|');
for (const row of rows) console.log(row);
