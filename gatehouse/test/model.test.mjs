// SPDX-License-Identifier: Apache-2.0
// Model-based test of TXNGUARD.
//
// An independent JavaScript implementation of the rules in
// docs/ARCHITECTURE.md (section 3) predicts the verdict of every record;
// thousands of random, mutated transfers then go through the real COBOL
// program (via Gatehouse) and every single verdict — and, for accepted
// transfers, the masking and the amount in cents — must match the model.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { luhnComplete, makeIban } from '../src/sample.mjs';
import { SKIP_REASON, postJson, startGatehouse } from './helpers.mjs';

/** SWIFT IBAN registry lengths, as in ALZIBAN. */
const IBAN_LENGTHS = {
  AD: 24, AE: 23, AL: 28, AT: 20, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, HR: 21, HU: 28, IE: 22, IL: 23,
  IS: 26, IT: 27, KZ: 20, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MT: 31, NL: 18, NO: 15,
  PL: 28, PT: 25, RO: 24, RS: 22, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27, TR: 26, UA: 29, VA: 22, XK: 20,
};
const CURRENCIES = new Set(['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'CAD', 'AUD', 'NZD']);
const CHANNELS = new Set(['ATM', 'WEB', 'POS', 'BRN', 'MOB', 'API']);
const SEPA = new Set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-?:().,\'+ ');
const LIMIT_CENTS = 100000000n;

// ---------------------------------------------------------------- model ---

const trimEnd = (text) => text.replace(/ +$/, '');

function mod97(text) {
  let rem = 0;
  for (const ch of text) {
    const v = /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : Number(ch);
    rem = (rem * (v > 9 ? 100 : 10) + v) % 97;
  }
  return rem;
}

/** 0 valid, 1 format, 2 country or length, 3 check digits — as ALZIBAN. */
function ibanRc(iban) {
  const v = trimEnd(iban);
  if (v.length < 15 || v.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(v)) return 1;
  if (IBAN_LENGTHS[v.slice(0, 2)] !== v.length) return 2;
  return mod97(v.slice(4) + v.slice(0, 4)) === 1 ? 0 : 3;
}

function luhnValid(pan) {
  let sum = 0;
  [...pan].reverse().forEach((c, i) => {
    let d = Number(c);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  });
  return sum % 10 === 0;
}

function daysInMonth(y, m) {
  return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function dayNumber(y, m, d) {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** The ALZAMNT state machine, written independently from the spec. */
function parseAmount(text) {
  const field = text.padEnd(18, ' ');
  let state = 'start';
  let sign = '+';
  let integer = 0n;
  let decimals = 0;
  let count = 0;
  for (const ch of field) {
    if (ch === ' ') {
      if (state === 'int' || state === 'dec' || state === 'trail') state = 'trail';
      else return { rc: 1 };
    } else if (ch === '+' || ch === '-') {
      if (state !== 'start') return { rc: 1 };
      sign = ch;
      state = 'signed';
    } else if (ch === '.') {
      if (state !== 'int') return { rc: 1 };
      state = 'point';
    } else if (ch >= '0' && ch <= '9') {
      if (state === 'start' || state === 'signed' || state === 'int') {
        integer = integer * 10n + BigInt(ch);
        if (integer >= 10n ** 13n) return { rc: 2 };
        state = 'int';
      } else if ((state === 'point' || state === 'dec') && count < 2) {
        decimals = decimals * 10 + Number(ch);
        count += 1;
        state = 'dec';
      } else {
        return { rc: 1 };
      }
    } else {
      return { rc: 1 };
    }
  }
  if (state !== 'int' && state !== 'dec' && state !== 'trail') return { rc: 1 };
  if (count === 1) decimals *= 10;
  return { rc: 0, sign, cents: integer * 100n + BigInt(decimals) };
}

/** Reason code TXNGUARD must give, applying the checks in their order. */
function expectedCode(t, seen, today) {
  const id = trimEnd(t.id);
  if (id === '' || !/^[A-Z0-9-]+$/.test(id)) return 'E101';
  const key = t.id.padEnd(12, ' ');
  if (seen.has(key)) return 'E102';
  seen.add(key);

  const ts = t.timestamp.padEnd(14, ' ');
  if (!/^\d{14}$/.test(ts)) return 'E201';
  const [y, mo, d, h, mi, s] = [0, 4, 6, 8, 10, 12].map((i) => Number(ts.slice(i, i + (i === 0 ? 4 : 2))));
  if (y < 1601 || mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h > 23 || mi > 59 || s > 59) return 'E201';
  if (dayNumber(y, mo, d) > today + 1) return 'E202';

  const from = ibanRc(t.from);
  if (from !== 0) return from === 3 ? 'E302' : 'E301';
  const to = ibanRc(t.to);
  if (to !== 0) return to === 3 ? 'E304' : 'E303';
  if (t.from === t.to) return 'E305';

  const amount = parseAmount(t.amount);
  if (amount.rc === 1) return 'E401';
  if (amount.rc === 2) return 'E402';
  if (amount.sign === '-' || amount.cents === 0n) return 'E403';
  if (amount.cents > LIMIT_CENTS) return 'E404';

  if (!CURRENCIES.has(t.currency.padEnd(3, ' '))) return 'E501';

  const pan = t.pan.padEnd(19, ' ');
  if (pan.trim() !== '') {
    const v = trimEnd(pan);
    if (v.length < 12 || !/^\d+$/.test(v)) return 'E601';
    if (!luhnValid(v)) return 'E602';
  }

  if (!CHANNELS.has(t.channel.padEnd(3, ' '))) return 'E701';

  const memo = trimEnd(t.memo.padEnd(40, ' '));
  if (memo !== '') {
    if ([...memo].some((c) => !SEPA.has(c))) return 'E801';
    if ('+-'.includes(memo.trimStart()[0])) return 'E802';
  }
  return 'A000';
}

function maskIban(iban) {
  return iban.slice(0, 4) + '*'.repeat(iban.length - 8) + iban.slice(-4);
}

function maskPan(pan) {
  const head = pan.length >= 15 ? 6 : 0;
  return pan.slice(0, head) + '*'.repeat(pan.length - head - 4) + pan.slice(-4);
}

// ------------------------------------------------------------ generator ---

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

const BBAN = { FR: 23, DE: 18, ES: 20, BE: 12, PT: 21, AT: 16, NO: 11, MT: 27 };
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';
const MEMO_CHARS = "abcdefghij ABCDEF 0123456789 /-?:().,'+";
const BAD_MEMO_CHARS = '<>;"=@#%&|!*$_[]{}~^`\\';

/** Maximum length Gatehouse accepts per field (before normalization). */
const FIELD_MAX = { id: 12, timestamp: 14, from: 34, to: 34, amount: 18, currency: 3, pan: 19, channel: 3, memo: 40 };

function generator(seed, { chaos = false } = {}) {
  const rand = prng(seed);
  const int = (n) => Math.floor(rand() * n);
  const pick = (list) => list[int(list.length)];
  const chance = (p) => rand() < p;
  const digits = (n) => Array.from({ length: n }, () => int(10)).join('');
  const iban = () => {
    const cc = pick(Object.keys(BBAN));
    return makeIban(cc, digits(BBAN[cc]));
  };
  const ids = [];

  const mutate = {
    id: (t) => {
      t.id = pick([
        () => t.id.toLowerCase(),
        () => `${t.id.slice(0, 3)};${t.id.slice(4)}`,
        () => '',
        () => ` ${t.id.slice(1)}`,
        () => `${t.id.slice(0, 2)} ${t.id.slice(3)}`,
        () => (ids.length ? pick(ids) : t.id),
        () => `${t.id.slice(0, 11)} `,
      ])();
    },
    timestamp: (t) => {
      t.timestamp = pick([
        '20230229101500', '20240229101500', '20250230101500', '20251301101500', '20251000101500', '20251020241500',
        '20251020106000', '20251020101560', '2025102010150X', '2025102010150', '16001231235959', '16010101000000',
        '20991231235959', '99991231235959', '00000000000000',
      ]);
    },
    from: (t) => {
      t.from = pick([
        () => t.from.slice(0, -1) + String((Number(t.from.at(-1)) + 1) % 10),
        () => t.from.slice(0, -1),
        () => `XX${t.from.slice(2)}`,
        () => t.from.toLowerCase(),
        () => t.from.replace(/(.{4})/g, '$1 ').trim(),
        () => `F7${t.from.slice(2)}`,
        () => `${t.from.slice(0, 2)}AB${t.from.slice(4)}`,
        () => t.from.slice(0, 14),
      ])();
    },
    to: (t) => {
      t.to = pick([() => t.from, () => t.to.slice(0, -1) + String((Number(t.to.at(-1)) + 3) % 10), () => `ZZ${t.to.slice(2)}`])();
    },
    amount: (t) => {
      t.amount = pick([
        '-500.00', '0', '0.00', '-0.00', '+0', '12345678901234.50', '9999999999999.99', '10000000000000', '0000000000000001',
        '10.005', '12.', '.50', '1e9', '1,000.00', '--5', '+', ' 12.00', '12 .50', '12.00 x', '1000000.00', '1000000.01',
        '+12.5', '7', '00000000000000000.1', '12.3.4',
      ]);
    },
    currency: (t) => {
      t.currency = pick(['BTC', 'eur', 'EU', 'E1R', 'XAU', 'JPY']);
    },
    pan: (t) => {
      t.pan = pick([
        () => t.pan.slice(0, -1) + String((Number(t.pan.at(-1) ?? '0') + 1) % 10),
        () => '41111111111',
        () => '4111x11111111111',
        () => '4111 1111 1111 1111',
        () => luhnComplete(digits(18)),
        () => luhnComplete(digits(11)),
      ])();
    },
    channel: (t) => {
      t.channel = pick(['XYZ', 'web', 'WE', 'W B']);
    },
    memo: (t) => {
      t.memo = pick([
        () => t.memo.slice(0, 5) + pick([...BAD_MEMO_CHARS]) + t.memo.slice(6),
        () => `-${t.memo}`.slice(0, 40),
        () => `+${t.memo}`.slice(0, 40),
        () => `   -2+3`,
        () => '',
        () => '          ',
        () => `${t.memo}  `.slice(0, 40),
      ])();
    },
  };
  const fields = Object.keys(mutate);

  return () => {
    const id = Array.from({ length: 1 + int(12) }, () => pick([...ID_CHARS])).join('');
    const t = {
      id,
      timestamp: `202${int(6)}${String(1 + int(12)).padStart(2, '0')}${String(1 + int(28)).padStart(2, '0')}` +
        `${String(int(24)).padStart(2, '0')}${String(int(60)).padStart(2, '0')}${String(int(60)).padStart(2, '0')}`,
      from: iban(),
      to: iban(),
      amount: `${int(100000)}${chance(0.7) ? `.${digits(1 + int(2))}` : ''}`,
      currency: pick([...CURRENCIES]),
      pan: chance(0.4) ? luhnComplete(digits(11 + int(8))) : '',
      channel: pick([...CHANNELS]),
      memo: Array.from({ length: int(41) }, () => pick([...MEMO_CHARS])).join(''),
    };
    const mutations = chance(0.35) ? 0 : 1 + int(2);
    for (let i = 0; i < mutations; i += 1) mutate[pick(fields)](t);
    if (chaos) {
      // Arbitrary printable ASCII, any length the field allows.
      for (const field of fields) {
        if (chance(0.3)) {
          t[field] = Array.from({ length: int(FIELD_MAX[field] + 1) }, () => String.fromCharCode(32 + int(95))).join('');
        }
      }
    }
    ids.push(t.id);
    return t;
  };
}

/** What Gatehouse forwards: IBANs upper-cased without spaces, PAN without spaces. */
function normalized(t) {
  return { ...t, from: t.from.replaceAll(' ', '').toUpperCase(), to: t.to.replaceAll(' ', '').toUpperCase(), pan: t.pan.replaceAll(' ', '') };
}

/** Respect Gatehouse's structural limits so the batch reaches TXNGUARD. */
function structurallyValid(t) {
  const n = normalized(t);
  return t.id.length <= 12 && t.timestamp.length <= 14 && t.from.length <= 42 && t.to.length <= 42 && n.from.length <= 34 &&
    n.to.length <= 34 && t.amount.length <= 18 && t.currency.length <= 3 && t.pan.length <= 23 && n.pan.length <= 19 &&
    t.channel.length <= 3 && t.memo.length <= 40;
}

// ---------------------------------------------------------------- tests ---

describe('TXNGUARD agrees with the reference model', { skip: SKIP_REASON }, () => {
  let gh;
  before(async () => {
    gh = await startGatehouse();
  });
  after(async () => {
    await gh.stop();
  });

  const runs = [
    ...[11, 22, 33, 44].map((seed) => ({ seed, chaos: false })),
    ...[55, 66].map((seed) => ({ seed, chaos: true })),
  ];
  for (const { seed, chaos } of runs) {
    it(`judges 1,000 random${chaos ? ' (chaos)' : ''} transfers exactly like the model (seed ${seed})`, async () => {
      const next = generator(seed, { chaos });
      const batch = [];
      while (batch.length < 1000) {
        const t = next();
        if (structurallyValid(t)) batch.push(t);
      }
      const res = await postJson(gh.base, '/api/batch', { transactions: batch });
      assert.equal(res.status, 200);
      const job = await res.json();

      const now = new Date();
      const today = dayNumber(now.getFullYear(), now.getMonth() + 1, now.getDate());
      const seen = new Set();
      const actual = new Map(job.rejections.map((r) => [r.line, r.code]));
      const accepted = new Map(job.accepted.map((a) => [a.id, a]));
      const mismatches = [];
      const codes = new Map();
      batch.forEach((raw, index) => {
        const t = normalized(raw);
        const want = expectedCode(t, seen, today);
        const got = actual.get(index + 1) ?? 'A000';
        codes.set(want, (codes.get(want) ?? 0) + 1);
        if (want !== got) mismatches.push({ line: index + 1, want, got, t: raw });
        if (want === 'A000' && got === 'A000') {
          const a = accepted.get(trimEnd(t.id));
          if (!a) return;
          const amount = parseAmount(t.amount);
          if (a.amountCents !== String(amount.cents)) mismatches.push({ line: index + 1, field: 'amountCents', want: String(amount.cents), got: a.amountCents });
          if (a.fromMasked !== maskIban(t.from)) mismatches.push({ line: index + 1, field: 'fromMasked', want: maskIban(t.from), got: a.fromMasked });
          if (a.toMasked !== maskIban(t.to)) mismatches.push({ line: index + 1, field: 'toMasked', want: maskIban(t.to), got: a.toMasked });
          const pan = t.pan === '' ? null : maskPan(t.pan);
          if (a.panMasked !== pan) mismatches.push({ line: index + 1, field: 'panMasked', want: pan, got: a.panMasked });
        }
      });
      if (process.env.ALCAZAR_MODEL_DEBUG) console.log(Object.fromEntries([...codes].sort()));
      assert.deepEqual(mismatches.slice(0, 10), [], `${mismatches.length} mismatches`);
      // The generator must exercise most rules, or the test proves little.
      assert.ok(codes.size >= 18, `only ${codes.size} distinct outcomes: ${[...codes.keys()].join(' ')}`);
      assert.equal(job.ledger.verification.valid, true);
    });
  }
});
