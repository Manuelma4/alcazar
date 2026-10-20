// SPDX-License-Identifier: Apache-2.0
// Deterministic sample batches for the dashboard and the tests: plausible
// European transfers with valid IBAN check digits and Luhn-valid test card
// numbers, plus planted anomalies for every defensive layer to find.
//
// The generator is a seeded PRNG on purpose — the same seed always gives the
// same batch. It is never used for anything secret.

/** Country code → BBAN pattern (A = letter, 9 = digit). */
const BBAN = {
  FR: '99999999999999999999999',
  DE: '999999999999999999',
  ES: '99999999999999999999',
  IT: 'A9999999999999999999999',
  NL: 'AAAA9999999999',
  BE: '999999999999',
  PT: '999999999999999999999',
  GB: 'AAAA99999999999999',
  AT: '9999999999999999',
  IE: 'AAAA99999999999999',
};

const CHANNELS = [['WEB', 40], ['MOB', 25], ['POS', 15], ['ATM', 8], ['BRN', 7], ['API', 5]];
const MEMOS = [
  'Invoice 2025-117', 'Rent October', 'Groceries', 'Salary', 'Consulting services', 'Refund order 8841',
  'Utilities', 'Gift', 'Insurance premium', 'Subscription', 'Dinner', 'Train tickets', 'School fees',
  'Loan repayment', 'Freelance design', 'Car service', 'Pharmacy', 'Books', 'Membership', '',
];
const CARD_PREFIXES = ['411111', '555555', '400005', '601111', '378282'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** mulberry32: a small, fast, seeded PRNG (not cryptographic). */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ISO 7064 MOD 97-10 over the IBAN digit string. */
function mod97(text) {
  let rem = 0;
  for (const ch of text) {
    const value = ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 55 : Number(ch);
    rem = (rem * (value > 9 ? 100 : 10) + value) % 97;
  }
  return rem;
}

export function makeIban(country, bban) {
  const check = 98 - mod97(`${bban}${country}00`);
  return `${country}${String(check).padStart(2, '0')}${bban}`;
}

export function luhnComplete(partial) {
  let sum = 0;
  for (let i = 0; i < partial.length; i += 1) {
    let d = Number(partial[partial.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return partial + String((10 - (sum % 10)) % 10);
}

function timestamp(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function formatCents(cents) {
  const value = BigInt(cents);
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

/**
 * @param {{ size?: number, seed?: number }} [options]
 * @returns {{ seed: number, transactions: Array<Record<string, string>> }}
 */
export function sampleBatch({ size = 200, seed = 42 } = {}) {
  const rand = prng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const digits = (n) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('');
  const weighted = (pairs) => {
    let r = rand() * pairs.reduce((s, [, w]) => s + w, 0);
    for (const [value, weight] of pairs) {
      r -= weight;
      if (r < 0) return value;
    }
    return pairs[0][0];
  };

  const gaussian = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());

  const countries = Object.keys(BBAN);
  const newAccount = () => {
    const country = pick(countries);
    const bban = [...BBAN[country]].map((c) => (c === 'A' ? pick(LETTERS) : digits(1))).join('');
    return makeIban(country, bban);
  };
  // Each account has its own typical spend (log10 of the amount): together
  // they span several orders of magnitude, which is what makes real payment
  // amounts follow Benford's law.
  const accounts = Array.from({ length: 160 }, () => ({ iban: newAccount(), level: 0.6 + rand() * 3 }));
  // Dedicated accounts for the planted patterns, so normal traffic does not
  // blur them.
  const [smurf, burst, quiet] = [newAccount(), newAccount(), newAccount()];
  // Roughly how many units of each sample currency one euro buys, so that a
  // typical amount means about the same in every currency. FRAUDSCAN never
  // compares amounts across currencies; a realistic batch shows why.
  const UNITS_PER_EUR = { EUR: 1, GBP: 0.85, CHF: 0.95, USD: 1.1, SEK: 11.5 };
  const typicalAmount = (level, currency) => {
    const log10 = Math.min(4.6, Math.max(0.3, level + 0.3 * gaussian()));
    return formatCents(Math.round(10 ** log10 * (UNITS_PER_EUR[currency] ?? 1) * 100));
  };
  const card = () => luhnComplete(pick(CARD_PREFIXES) + digits(9));
  const start = Date.UTC(2025, 9, 20, 0, 0, 0) / 1000;

  const txns = [];
  const add = (fields) => {
    const sender = pick(accounts);
    const from = fields.from ?? sender.iban;
    let to = fields.to ?? pick(accounts).iban;
    while (to === from) to = pick(accounts).iban;
    const channel = fields.channel ?? weighted(CHANNELS);
    const currency = fields.currency ?? (rand() < 0.85 ? 'EUR' : pick(['GBP', 'CHF', 'USD', 'SEK']));
    const txn = {
      id: `TX-${String(txns.length + 1).padStart(8, '0')}`,
      timestamp: timestamp(fields.at ?? start + Math.floor(rand() * 86400)),
      from,
      to,
      amount: fields.amount ?? typicalAmount(sender.level, currency),
      currency,
      channel,
      memo: fields.memo ?? pick(MEMOS),
    };
    if (fields.pan ?? (channel === 'POS' || channel === 'ATM')) txn.pan = fields.pan ?? card();
    txns.push(txn);
    return txn;
  };

  // 18 planted transfers: 3 structuring, 6 velocity, 6 + 1 outlier history,
  // 1 high-entropy memo and 1 replay.
  const planted = size >= 40;
  const normal = planted ? size - 18 : size;
  for (let i = 0; i < normal; i += 1) add({});
  if (planted) {
    // Fortran layer: structuring, velocity, an outlier with a history, and
    // a high-entropy memo.
    // In euros: the structuring band and the outlier are euro amounts.
    const EUR = 'EUR';
    for (let i = 0; i < 3; i += 1) {
      add({ from: smurf, amount: formatCents(980000 + Math.floor(rand() * 19000)), currency: EUR, at: start + 30000 + i * 5400, memo: 'Consulting' });
    }
    for (let i = 0; i < 6; i += 1) {
      add({ from: burst, amount: formatCents(1500 + Math.floor(rand() * 1500)), currency: EUR, at: start + 70000 + i * 45, channel: 'MOB', memo: 'Gift card' });
    }
    for (let i = 0; i < 6; i += 1) {
      add({ from: quiet, amount: formatCents(3000 + Math.floor(rand() * 5000)), currency: EUR, at: start + i * 12000, memo: 'Groceries' });
    }
    add({ from: quiet, amount: '25000.00', currency: EUR, at: start + 11520, memo: 'Urgent' });
    // 28 distinct base32 characters: log2(28) = 4.8 bits per character, above
    // FRAUDSCAN's 4.0-bit threshold whatever the seed (28 random picks with
    // repeats can fall below it).
    const pool = [...BASE32];
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    add({ memo: pool.slice(0, 28).join('') });
    // COBOL layer: one attack per business rule.
    const victims = txns.slice(0, normal);
    const victim = (index) => victims[index % victims.length];
    Object.assign(victim(3), { amount: '-250.00' });
    const forged = victim(11);
    forged.from = forged.from.slice(0, -1) + String((Number(forged.from.at(-1)) + 1) % 10);
    Object.assign(victim(17), { currency: 'BTC' });
    Object.assign(victim(23), { timestamp: '20250230101500' });
    Object.assign(victim(29), { pan: '4111111111111112', channel: 'POS' });
    Object.assign(victim(31), { memo: '+33 6 12 34 56 78' });
    victim(37).to = victim(37).from;
    Object.assign(victim(41), { amount: '19.999' });
    // A replay: the same transfer submitted again under the same id.
    const original = victim(5);
    add({ amount: original.amount, currency: original.currency, from: original.from, to: original.to }).id = original.id;
  }
  return { seed, transactions: txns.slice(0, size) };
}
