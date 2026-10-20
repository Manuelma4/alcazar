// SPDX-License-Identifier: Apache-2.0
// FRAUDSCAN on hand-made ACCEPTED records: amounts in different currencies
// are never compared with each other, and structuring is judged against
// each currency's own reporting threshold.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ROOT } from '../src/config.mjs';
import { parseRisk } from '../src/records.mjs';
import { runLegacy } from '../src/runner.mjs';
import { SKIP_REASON } from './helpers.mjs';

const START = Date.UTC(2025, 9, 1);

/** One ACCEPTED record (206 bytes + LF); transfers are an hour apart, so VELOCITY stays quiet. */
function record(index, { sender, cents, currency = 'EUR', memo = 'Invoice' }) {
  const ts = new Date(START + index * 3_600_000).toISOString().replace(/\D/g, '').slice(0, 14);
  return `${[`T-${index}`.padEnd(12), ts, sender, 'b'.repeat(16), 'FR76*******************0189'.padEnd(34),
    'DE89**************3000'.padEnd(34), String(cents).padStart(15, '0'), currency, 'WEB', ' '.repeat(19), memo.padEnd(40)].join('')}\n`;
}

async function scan(transfers) {
  const dir = await mkdtemp(join(tmpdir(), 'alcazar-fraudscan-'));
  try {
    await writeFile(join(dir, 'ACCEPTED.DAT'), transfers.map((t, i) => record(i + 1, t)).join(''), 'latin1');
    const result = await runLegacy(join(ROOT, 'build', 'bin', 'fraudscan'), ['ACCEPTED.DAT', 'RISK.JSON'], {
      cwd: dir, timeoutMs: 20_000, maxOutputBytes: 65_536,
    });
    assert.equal(result.code, 0, result.stderr);
    const risk = parseRisk(await readFile(join(dir, 'RISK.JSON'), 'utf8'));
    return { risk, byId: (n) => risk.transactions.find((t) => t.id === `T-${n}`) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const sender = (digit) => `${'a'.repeat(15)}${digit}`;
const history = (who, count, cents) => Array.from({ length: count }, (_, i) => ({ sender: who, cents: cents + i * 37 }));

describe('FRAUDSCAN is currency-aware', { skip: SKIP_REASON }, () => {
  it('never scores an amount against another currency', async () => {
    // Six transfers of about 50 EUR, then 5,000 SEK (about 450 EUR): an
    // outlier only if euros and kronor were the same thing.
    const { byId } = await scan([...history(sender(1), 6, 5000), { sender: sender(1), cents: 500000, currency: 'SEK' }]);
    assert.equal(byId(7).z, null, 'one SEK transfer has nothing to be compared with');
    assert.ok(!byId(7).signals.includes('ZSCORE'));
    for (let i = 1; i <= 6; i += 1) assert.deepEqual(byId(i).signals, []);
  });

  it('still flags an outlier in the same currency', async () => {
    const { byId } = await scan([...history(sender(2), 6, 5000), { sender: sender(2), cents: 500000 }]);
    assert.ok(byId(7).signals.includes('ZSCORE'));
    assert.ok(byId(7).z > 3.5);
  });

  it('scores a small sender against the batch in its own currency only', async () => {
    const sek = Array.from({ length: 6 }, (_, i) => ({ sender: sender(3), cents: 57_500 + i * 400, currency: 'SEK' }));
    const { byId } = await scan([...history(sender(4), 6, 5000), ...sek, { sender: sender(5), cents: 60_000, currency: 'SEK' }]);
    assert.notEqual(byId(13).z, null);
    assert.ok(!byId(13).signals.includes('ZSCORE'), '600 SEK is ordinary among SEK transfers');
  });

  it('judges structuring against each currency’s own threshold', async () => {
    const { risk, byId } = await scan([
      { sender: sender(6), cents: 9_500_000, currency: 'SEK' }, { sender: sender(6), cents: 9_800_000, currency: 'SEK' },
      { sender: sender(7), cents: 950_000, currency: 'SEK' }, { sender: sender(7), cents: 980_000, currency: 'SEK' },
      { sender: sender(8), cents: 950_000 }, { sender: sender(8), cents: 990_000 },
      { sender: sender(9), cents: 950_000 }, { sender: sender(9), cents: 9_600_000, currency: 'SEK' },
      { sender: sender(0), cents: 950_000, currency: 'XTS' }, { sender: sender(0), cents: 960_000, currency: 'XTS' },
    ]);
    const structuring = (n) => byId(n).signals.includes('STRUCTURING');
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(structuring),
      [true, true, false, false, true, true, true, true, false, false]);
    assert.equal(risk.thresholds.structuring.length, 14);
    assert.deepEqual(risk.thresholds.structuring.find((b) => b.currency === 'EUR'), { currency: 'EUR', lowCents: 900000, highCents: 1000000 });
    assert.deepEqual(risk.thresholds.structuring.find((b) => b.currency === 'SEK'), { currency: 'SEK', lowCents: 9000000, highCents: 10000000 });
  });
});
