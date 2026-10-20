// SPDX-License-Identifier: Apache-2.0
// One batch job: Gatehouse → TXNGUARD (COBOL) → FRAUDSCAN (Fortran) → Seal
// verification (LEDGERCK + Node/OpenSSL + anchor).

import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './http.mjs';
import { deriveKeys, genesisMac, keyLines, tamperLedger, tamperRecord, trimRecords, verifyLedger } from './ledger.mjs';
import { reasonText } from './messages.mjs';
import {
  RecordError, parseAccepted, parseLedger, parseLedgerck, parseRejected, parseRisk, parseSeal, parseSummary, txnInLines,
} from './records.mjs';
import { Gate } from './gate.mjs';
import { runLegacy } from './runner.mjs';

/** A file the job should have; missing reads as empty (the verifiers then say what is gone). */
async function readJobFile(dir, name) {
  try {
    return await readFile(join(dir, name), 'latin1');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

/** ALZMASK "P": the last 4 digits, and the BIN (first 6) too from 15 digits up. */
function maskedPan(pan) {
  if (!pan) return null;
  const head = pan.length >= 15 ? 6 : 0;
  return pan.slice(0, head) + '*'.repeat(pan.length - head - 4) + pan.slice(-4);
}

/** Cents of a submitted amount, as ALZAMNT reads an accepted one (else null). */
function submittedCents(amount) {
  const m = /^\+?(\d+)(?:\.(\d{1,2}))? *$/.exec(amount);
  return m ? String(BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'))) : null;
}

/**
 * FRAUDSCAN's report is untrusted for meaning, not just for shape: it must
 * have scored exactly the accepted records, in order, its counts must add up
 * and its amount range must be theirs — a report that drops, invents or
 * silences a transfer is refused.
 */
function riskMatches(risk, accepted) {
  const sum = (values) => values.reduce((total, v) => total + v, 0);
  // At most 15 digits of cents: exact as numbers.
  const cents = accepted.map((record) => Number(record.amountCents));
  return risk.n === accepted.length && risk.transactions.length === accepted.length &&
    risk.transactions.every((t, i) => t.id === accepted[i].id) &&
    risk.flagged === risk.transactions.filter((t) => t.signals.length > 0).length &&
    risk.benford.n === risk.n && sum(risk.benford.counts) === risk.n && sum(risk.amounts.histogram.counts) === risk.n &&
    risk.amounts.minCents === (cents.length ? Math.min(...cents) : 0) &&
    risk.amounts.maxCents === (cents.length ? Math.max(...cents) : 0);
}

export class Pipeline {
  /**
   * @param {{ config: ReturnType<import('./config.mjs').loadConfig>, masterKey: Buffer }} options
   */
  constructor({ config, masterKey }) {
    this.config = config;
    // Least privilege: the master key stays here (and is wiped by the
    // caller); each legacy program reads only the sub-keys it needs from
    // stdin — TXNGUARD seals and pseudonymises, LEDGERCK only verifies.
    this.keys = deriveKeys(masterKey);
    this.guardKeys = keyLines(this.keys.ledger, this.keys.token);
    this.checkKeys = keyLines(this.keys.ledger);
    this.gate = new Gate(config.limits.maxProcesses, config.limits.processQueue);
  }

  bin(name) {
    return join(this.config.binDir, name);
  }

  async legacy(name, args, dir, stdin) {
    const { jobTimeoutMs, maxOutputBytes } = this.config.limits;
    const result = await this.gate.run(async () => {
      try {
        return await runLegacy(this.bin(name), args, { cwd: dir, stdin, timeoutMs: jobTimeoutMs, maxOutputBytes });
      } catch {
        throw new HttpError(502, 'P-LEGACY', `${name} could not be started`);
      }
    });
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
    // TXNGUARD reads the batch on stdin, right after its keys.
    const input = Buffer.concat([this.guardKeys, txnInLines(transactions)]);
    stages.push({
      name: 'gatehouse',
      status: 'ok',
      ms: Math.round(validationMs + performance.now() - started),
      detail: { in: transactions.length },
    });

    let guard;
    try {
      guard = await this.legacy('txnguard', [jobId], dir, input);
    } finally {
      input.fill(0);
    }
    if (guard.code !== 0 && guard.code !== 4) {
      throw new HttpError(502, 'P-LEGACY', 'TXNGUARD failed', { legacyRc: guard.code });
    }

    // Every sealed file is read once: these bytes are parsed, scored,
    // verified and shown — nothing reads the job directory again in between.
    // The anchor comes from TXNGUARD's stdout, a pipe only Gatehouse holds.
    let seal;
    let files;
    let summary;
    let accepted;
    let rejected;
    let entries;
    try {
      seal = parseSeal(guard.stdout);
      files = {
        ledger: await readFile(join(dir, 'LEDGER.DAT'), 'latin1'),
        accepted: await readFile(join(dir, 'ACCEPTED.DAT'), 'latin1'),
        rejected: await readFile(join(dir, 'REJECTED.DAT'), 'latin1'),
      };
      summary = parseSummary(await readFile(join(dir, 'SUMMARY.DAT'), 'latin1'));
      accepted = parseAccepted(files.accepted);
      rejected = parseRejected(files.rejected);
      entries = parseLedger(files.ledger);
    } catch (error) {
      if (error instanceof RecordError) throw new HttpError(502, 'P-LEGACY', 'TXNGUARD produced malformed output');
      throw error;
    }
    // Totals are recomputed from the accepted records — the bytes that are
    // verified — and SUMMARY.DAT, which nothing seals, must agree with them.
    const totalsByCurrency = Object.create(null);
    for (const record of accepted) {
      totalsByCurrency[record.currency] = String(BigInt(totalsByCurrency[record.currency] ?? '0') + BigInt(record.amountCents));
    }
    const sameTotals = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((ccy) => a[ccy] === b[ccy]);
    if (summary.job !== jobId || summary.records !== transactions.length || summary.accepted !== accepted.length ||
        summary.rejected !== rejected.length || summary.ledgerEntries !== seal.entries || summary.ledgerHead !== seal.head ||
        !sameTotals(totalsByCurrency, summary.totalsByCurrency)) {
      throw new HttpError(502, 'P-LEGACY', 'TXNGUARD output is inconsistent');
    }
    this.matchInput(transactions, entries, accepted, rejected, seal);
    stages.push({
      name: 'txnguard',
      status: rejected.length ? 'warn' : 'ok',
      ms: guard.ms,
      rc: guard.code,
      detail: { records: summary.records, accepted: accepted.length, rejected: rejected.length },
    });

    // FRAUDSCAN scores exactly these bytes: piped in, its report piped out.
    const scan = await this.legacy('fraudscan', ['-', '-'], dir, Buffer.from(files.accepted, 'latin1'));
    if (scan.code !== 0) throw new HttpError(502, 'P-LEGACY', 'FRAUDSCAN failed', { legacyRc: scan.code });
    let risk;
    try {
      risk = parseRisk(scan.stdout);
    } catch (error) {
      if (error instanceof RecordError) throw new HttpError(502, 'P-LEGACY', 'FRAUDSCAN produced malformed output');
      throw error;
    }
    if (!riskMatches(risk, accepted)) throw new HttpError(502, 'P-LEGACY', 'FRAUDSCAN output does not match the accepted records');
    stages.push({
      name: 'fraudscan',
      status: risk.flagged ? 'warn' : 'ok',
      ms: scan.ms,
      rc: scan.code,
      detail: { scored: risk.n, flagged: risk.flagged },
    });

    const state = { jobId, dir, anchor: { entries: seal.entries, head: seal.head } };
    const verification = await this.verify(state, files);
    stages.push({
      name: 'seal',
      status: verification.valid ? 'ok' : 'error',
      ms: verification.ms,
      detail: { entries: verification.entries, verifiers: verification.verifiedBy.length },
    });

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
        totalsByCurrency,
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
        head: seal.head,
        entries,
        verification,
      },
    };
    return { job, state };
  }

  /**
   * What TXNGUARD sealed must be what Gatehouse sent: one ledger entry per
   * submitted transfer, in order, and every accepted record equal to its
   * transfer field by field, the account tokens recomputed with K_token. An
   * input file altered under TXNGUARD's feet — or a TXNGUARD that altered a
   * transfer — cannot pass.
   */
  matchInput(transactions, entries, accepted, rejected, seal) {
    const fail = () => {
      throw new HttpError(502, 'P-LEGACY', 'TXNGUARD output does not match the submitted batch');
    };
    if (seal.entries !== transactions.length || entries.length !== transactions.length ||
        accepted.length + rejected.length !== transactions.length) fail();
    let a = 0;
    let r = 0;
    entries.forEach((entry, index) => {
      const t = transactions[index];
      if (entry.seq !== index + 1) fail();
      if (entry.type === 'A') {
        const record = accepted[a];
        a += 1;
        if (!record || record.id !== t.id.trimEnd() || record.timestamp !== t.timestamp ||
            record.amountCents !== submittedCents(t.amount) || record.currency !== t.currency || record.channel !== t.channel ||
            record.memo !== (t.memo ?? '').trimEnd() || record.panMasked !== maskedPan(t.pan ?? '') ||
            record.fromToken !== this.token(t.from) || record.toToken !== this.token(t.to)) {
          fail();
        }
      } else {
        const record = rejected[r];
        r += 1;
        if (!record || record.line !== index + 1) fail();
      }
    });
  }

  /**
   * Verify a job's ledger — the chain and every ACCEPTED / REJECTED record
   * it seals — three ways: LEDGERCK (COBOL + Fortran HMAC), an independent
   * Node.js / OpenSSL implementation, and the anchor (entry count and head
   * MAC recorded when the job was sealed).
   *
   * Node verifies `files` when given — the bytes the caller parsed and will
   * show — and the job's files as they are now otherwise. LEDGERCK reads the
   * job directory itself. If the files change in between, the two verdicts
   * are about different bytes and cannot agree on "valid" (that would take
   * a second valid ledger with the same head, i.e. a forged MAC): the result
   * is then "broken", never "valid".
   */
  async verify(state, files = null) {
    const started = performance.now();
    const current = files ?? {
      ledger: await readJobFile(state.dir, 'LEDGER.DAT'),
      accepted: await readJobFile(state.dir, 'ACCEPTED.DAT'),
      rejected: await readJobFile(state.dir, 'REJECTED.DAT'),
    };
    const check = await this.legacy('ledgerck', [state.jobId], state.dir, this.checkKeys);
    if (check.code !== 0 && check.code !== 4) {
      throw new HttpError(502, 'P-LEGACY', 'LEDGERCK failed', { legacyRc: check.code });
    }
    let cobol;
    try {
      cobol = parseLedgerck(check.stdout);
    } catch {
      throw new HttpError(502, 'P-LEGACY', 'LEDGERCK produced malformed output');
    }
    const node = verifyLedger(current.ledger, this.keys.ledger, state.jobId, current);
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

  /**
   * Demo only: rewrite the job's files as an insider would — the ledger
   * itself, or (mode "record") the decision record behind an entry.
   */
  async tamper(state, seq, mode) {
    const write = (name, text) => writeFile(join(state.dir, name), text, { encoding: 'latin1', mode: 0o600 });
    const ledgerText = await readJobFile(state.dir, 'LEDGER.DAT');
    const records = { accepted: await readJobFile(state.dir, 'ACCEPTED.DAT'), rejected: await readJobFile(state.dir, 'REJECTED.DAT') };
    if (mode === 'record') {
      const changed = tamperRecord(ledgerText, records, seq);
      await write(changed.file, changed.text);
      return { entries: parseLedger(ledgerText), file: changed.file, before: changed.before, after: changed.after };
    }
    const changed = tamperLedger(ledgerText, seq, mode);
    await write('LEDGER.DAT', changed.text);
    if (mode === 'truncate') {
      // The records go too: what is left is a valid, shorter ledger.
      const trimmed = trimRecords(changed.text, records);
      await write('ACCEPTED.DAT', trimmed.accepted);
      await write('REJECTED.DAT', trimmed.rejected);
    }
    return { entries: parseLedger(changed.text), file: 'LEDGER.DAT', before: changed.before, after: changed.after };
  }

  /** Overwrite the key material held by this pipeline (on shutdown). */
  wipe() {
    this.guardKeys.fill(0);
    this.checkKeys.fill(0);
    this.keys.ledger.fill(0);
    this.keys.token.fill(0);
  }

  /** The pseudonymous token TXNGUARD derives for an IBAN (used by the self-test). */
  token(iban) {
    return createHmac('sha256', this.keys.token).update(iban, 'latin1').digest('hex').slice(0, 16);
  }
}
