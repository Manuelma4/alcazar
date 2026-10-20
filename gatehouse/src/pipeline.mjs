// SPDX-License-Identifier: Apache-2.0
// One batch job: Gatehouse → TXNGUARD (COBOL) → FRAUDSCAN (Fortran) → Seal
// verification (LEDGERCK + Node/OpenSSL + anchor).

import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './http.mjs';
import { deriveKeys, genesisMac, tamperLedger, verifyLedger } from './ledger.mjs';
import { reasonText } from './messages.mjs';
import {
  RecordError, parseAccepted, parseLedger, parseLedgerck, parseRejected, parseRisk, parseSummary, txnInFile,
} from './records.mjs';
import { runLegacy } from './runner.mjs';

export class Pipeline {
  /**
   * @param {{ config: ReturnType<import('./config.mjs').loadConfig>, masterKey: Buffer }} options
   */
  constructor({ config, masterKey }) {
    this.config = config;
    // Kept as a Buffer, never a string: strings are immutable and cannot be
    // wiped. The legacy programs read it from stdin.
    this.keyLine = Buffer.concat([Buffer.from(masterKey.toString('hex'), 'latin1'), Buffer.from('\n')]);
    this.keys = deriveKeys(masterKey);
  }

  bin(name) {
    return join(this.config.binDir, name);
  }

  async legacy(name, args, dir, stdin) {
    const { jobTimeoutMs, maxOutputBytes } = this.config.limits;
    let result;
    try {
      result = await runLegacy(this.bin(name), args, { cwd: dir, stdin, timeoutMs: jobTimeoutMs, maxOutputBytes });
    } catch {
      throw new HttpError(502, 'P-LEGACY', `${name} could not be started`);
    }
    if (result.timedOut) throw new HttpError(504, 'P-TIMEOUT', `${name} exceeded ${jobTimeoutMs} ms`);
    return result;
  }

  /**
   * @param {Array<Record<string, string>>} transactions  validated by schema.mjs
   * @param {{ validationMs: number }} timings
   */
  async run(transactions, { validationMs }) {
    const jobId = `j-${randomBytes(12).toString('hex')}`;
    const dir = await mkdtemp(join(this.config.workDir, 'job-'));
    try {
      return await this.execute(jobId, dir, transactions, validationMs);
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }

  async execute(jobId, dir, transactions, validationMs) {
    const stages = [];
    const started = performance.now();
    await writeFile(join(dir, 'TXNIN.DAT'), txnInFile(transactions), { flag: 'wx', mode: 0o600 });
    stages.push({
      name: 'gatehouse',
      status: 'ok',
      ms: Math.round(validationMs + performance.now() - started),
      detail: { in: transactions.length },
    });

    const guard = await this.legacy('txnguard', [jobId], dir, this.keyLine);
    // TXNIN.DAT holds raw card numbers: delete it as soon as TXNGUARD is done.
    await rm(join(dir, 'TXNIN.DAT'), { force: true });
    if (guard.code !== 0 && guard.code !== 4) {
      throw new HttpError(502, 'P-LEGACY', 'TXNGUARD failed', { legacyRc: guard.code });
    }

    let summary;
    let accepted;
    let rejected;
    let ledgerText;
    try {
      summary = parseSummary(await readFile(join(dir, 'SUMMARY.DAT'), 'latin1'));
      accepted = parseAccepted(await readFile(join(dir, 'ACCEPTED.DAT'), 'latin1'));
      rejected = parseRejected(await readFile(join(dir, 'REJECTED.DAT'), 'latin1'));
      ledgerText = await readFile(join(dir, 'LEDGER.DAT'), 'latin1');
    } catch (error) {
      if (error instanceof RecordError) throw new HttpError(502, 'P-LEGACY', 'TXNGUARD produced malformed output');
      throw error;
    }
    if (summary.job !== jobId || summary.records !== transactions.length || summary.accepted !== accepted.length ||
        summary.rejected !== rejected.length) {
      throw new HttpError(502, 'P-LEGACY', 'TXNGUARD output is inconsistent');
    }
    stages.push({
      name: 'txnguard',
      status: rejected.length ? 'warn' : 'ok',
      ms: guard.ms,
      rc: guard.code,
      detail: { records: summary.records, accepted: accepted.length, rejected: rejected.length },
    });

    const scan = await this.legacy('fraudscan', ['ACCEPTED.DAT', 'RISK.JSON'], dir, '');
    if (scan.code !== 0) throw new HttpError(502, 'P-LEGACY', 'FRAUDSCAN failed', { legacyRc: scan.code });
    let risk;
    try {
      risk = parseRisk(await readFile(join(dir, 'RISK.JSON'), 'utf8'));
    } catch (error) {
      if (error instanceof RecordError) throw new HttpError(502, 'P-LEGACY', 'FRAUDSCAN produced malformed output');
      throw error;
    }
    stages.push({
      name: 'fraudscan',
      status: risk.flagged ? 'warn' : 'ok',
      ms: scan.ms,
      rc: scan.code,
      detail: { scored: risk.n, flagged: risk.flagged },
    });

    const state = { jobId, dir, anchor: { entries: summary.ledgerEntries, head: summary.ledgerHead } };
    const verification = await this.verify(state);
    stages.push({
      name: 'seal',
      status: verification.valid ? 'ok' : 'error',
      ms: verification.ms,
      detail: { entries: verification.entries, verifiers: verification.verifiedBy.length },
    });

    const entries = parseLedger(ledgerText);
    const job = {
      job: jobId,
      createdAt: new Date().toISOString(),
      expiresAt: '',
      stages,
      summary: {
        received: transactions.length,
        accepted: accepted.length,
        rejected: rejected.length,
        flagged: risk.flagged,
        totalsByCurrency: summary.totalsByCurrency,
      },
      // Gatehouse joins rejections to the submitted ids by line number;
      // legacyId is TXNGUARD's sanitized copy.
      rejections: rejected.map((r) => ({
        line: r.line,
        id: transactions[r.line - 1]?.id ?? r.legacyId,
        legacyId: r.legacyId,
        code: r.code,
        field: r.field,
        detail: r.detail,
        message: reasonText(r.code),
      })),
      accepted,
      risk,
      ledger: {
        algorithm: 'HMAC-SHA256',
        genesis: genesisMac(this.keys.ledger, jobId),
        head: summary.ledgerHead,
        entries,
        verification,
      },
    };
    return { job, state };
  }

  /**
   * Verify a job's ledger three ways: LEDGERCK (COBOL + Fortran HMAC), an
   * independent Node.js / OpenSSL implementation, and the anchor (entry
   * count and head MAC recorded when the job was sealed).
   */
  async verify(state) {
    const started = performance.now();
    const text = await readFile(join(state.dir, 'LEDGER.DAT'), 'latin1');
    const check = await this.legacy('ledgerck', [state.jobId], state.dir, this.keyLine);
    if (check.code !== 0 && check.code !== 4) {
      throw new HttpError(502, 'P-LEGACY', 'LEDGERCK failed', { legacyRc: check.code });
    }
    let cobol;
    try {
      cobol = parseLedgerck(check.stdout);
    } catch {
      throw new HttpError(502, 'P-LEGACY', 'LEDGERCK produced malformed output');
    }
    const node = verifyLedger(text, this.keys.ledger, state.jobId);
    const agree = cobol.valid === node.valid && cobol.entries === node.entries && cobol.reason === node.reason &&
      cobol.brokenAt === node.brokenAt && cobol.head === node.head;
    if (!agree) {
      // Two independent implementations disagree: never report "valid".
      return { valid: false, entries: Math.min(cobol.entries, node.entries), head: null, brokenAt: cobol.brokenAt ?? node.brokenAt ?? 1,
        reason: cobol.reason ?? node.reason ?? 'FORMAT', verifiedBy: [], ms: Math.round(performance.now() - started) };
    }
    let result = { ...cobol, verifiedBy: ['cobol-fortran', 'node-openssl'] };
    if (result.valid) {
      if (result.entries !== state.anchor.entries || result.head !== state.anchor.head) {
        // A valid but shorter chain: entries were cut off the end. Only the
        // anchor kept outside the ledger file can reveal it.
        result = { valid: false, entries: result.entries, head: null, brokenAt: Math.min(result.entries, state.anchor.entries) + 1,
          reason: 'HEAD-MISMATCH', verifiedBy: ['anchor'] };
      } else {
        result.verifiedBy.push('anchor');
      }
    }
    return { ...result, ms: Math.round(performance.now() - started) };
  }

  /** Demo only: rewrite the job's ledger file as an insider would. */
  async tamper(state, seq, mode) {
    const path = join(state.dir, 'LEDGER.DAT');
    const changed = tamperLedger(await readFile(path, 'latin1'), seq, mode);
    await writeFile(path, changed.text, { encoding: 'latin1', mode: 0o600 });
    return { entries: parseLedger(changed.text), before: changed.before, after: changed.after };
  }

  /** Overwrite the key material held by this pipeline (on shutdown). */
  wipe() {
    this.keyLine.fill(0);
    this.keys.ledger.fill(0);
    this.keys.token.fill(0);
  }

  /** The pseudonymous token TXNGUARD derives for an IBAN (used by the self-test). */
  token(iban) {
    return createHmac('sha256', this.keys.token).update(iban, 'latin1').digest('hex').slice(0, 16);
  }
}
