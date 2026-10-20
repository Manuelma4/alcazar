// Lookout · format: pure formatting helpers (no DOM, no globals) so they can be
// unit-tested in Node. Money never goes through floating point: cents are
// split with BigInt and the locale only formats the integer part.

export const LOCALE = 'en-GB';

const CENTS_TEXT = /^\s*([+-]?)(\d{1,30})\s*$/;

/**
 * Split an integer amount of cents into exact parts.
 * @param {string | number | bigint} cents
 * @returns {{ negative: boolean, major: bigint, minor: string } | null}
 */
export function splitCents(cents) {
  let negative = false;
  let digits;
  if (typeof cents === 'bigint') {
    negative = cents < 0n;
    digits = (negative ? -cents : cents).toString();
  } else if (typeof cents === 'number') {
    if (!Number.isSafeInteger(cents)) return null;
    negative = cents < 0;
    digits = String(Math.abs(cents));
  } else if (typeof cents === 'string') {
    const match = CENTS_TEXT.exec(cents);
    if (!match) return null;
    negative = match[1] === '-';
    digits = match[2];
  } else {
    return null;
  }
  const padded = digits.padStart(3, '0');
  const major = BigInt(padded.slice(0, -2));
  const minor = padded.slice(-2);
  if (major === 0n && minor === '00') negative = false;
  return { negative, major, minor };
}

const formatters = new Map();
function currencyFormatter(currency, display) {
  const key = `${currency}|${display}`;
  if (!formatters.has(key)) {
    let nf = null;
    try {
      nf = new Intl.NumberFormat(LOCALE, {
        style: 'currency',
        currency,
        currencyDisplay: display,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } catch {
      nf = null;
    }
    formatters.set(key, nf);
  }
  return formatters.get(key);
}

/** 1234567n → "1,234,567" without Intl (fallback path). */
export function groupDigits(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format cents as money, exactly.
 * @param {string | number | bigint} cents   e.g. "17524009"
 * @param {string} currency                  ISO 4217 alpha-3, e.g. "EUR"
 * @param {{ display?: 'symbol' | 'code' | 'narrowSymbol' }} [options]
 */
export function formatMoney(cents, currency, { display = 'symbol' } = {}) {
  const parts = splitCents(cents);
  if (!parts) return String(cents ?? '');
  const code = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : null;
  const nf = code ? currencyFormatter(code, display) : null;
  const sign = parts.negative ? '\u{2212}' : '';
  if (!nf) return `${sign}${groupDigits(parts.major)}.${parts.minor}${code ? ` ${code}` : ''}`;
  // Format a BigInt with the right sign, then swap in the exact cents.
  const probe = parts.negative ? -(parts.major === 0n ? 1n : parts.major) : parts.major;
  let sawFraction = false;
  const out = nf.formatToParts(probe).map((part) => {
    if (part.type === 'fraction') {
      sawFraction = true;
      return parts.minor;
    }
    if (part.type === 'integer' && parts.negative && parts.major === 0n) return '0';
    return part.value;
  }).join('');
  return sawFraction ? out : `${out}.${parts.minor}`;
}

/** Cents as an exact decimal without a currency symbol: "19876" → "198.76". */
export function formatCentsPlain(cents) {
  const parts = splitCents(typeof cents === 'number' ? Math.round(cents) : cents);
  if (!parts) return String(cents ?? '');
  return `${parts.negative ? '\u{2212}' : ''}${intFormatBig(parts.major)}.${parts.minor}`;
}

const bigFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
function intFormatBig(value) {
  try {
    return bigFormat.format(value);
  } catch {
    return groupDigits(value);
  }
}

/** Cents → number of major units, for chart geometry only (never for display). */
export function centsToUnits(cents) {
  const parts = splitCents(cents);
  if (!parts) return NaN;
  const value = Number(parts.major) + Number(parts.minor) / 100;
  return parts.negative ? -value : value;
}

const intFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
export function formatInt(n) {
  return Number.isFinite(n) ? intFormat.format(n) : '\u{2014}';
}

export function formatDecimal(n, digits = 2) {
  if (!Number.isFinite(n)) return '\u{2014}';
  return new Intl.NumberFormat(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function formatPercent(ratio, digits = 1) {
  if (!Number.isFinite(ratio)) return '\u{2014}';
  return new Intl.NumberFormat(LOCALE, { style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(ratio);
}

/** Compact amounts for axis ticks: 1, 10, 100, 1K, 10K, 1M. */
export function formatCompact(n) {
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function formatMs(ms) {
  if (!Number.isFinite(ms)) return '\u{2014}';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${formatDecimal(ms / 1000, ms < 10000 ? 2 : 1)} s`;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '\u{2014}';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatDecimal(bytes / 1024, bytes % 1024 ? 1 : 0)} KiB`;
  return `${formatDecimal(bytes / (1024 * 1024), bytes % (1024 * 1024) ? 1 : 0)} MiB`;
}

/** "mm:ss" for a remaining duration. */
export function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

const TS = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/**
 * Parse a TXN-TS (YYYYMMDDHHMMSS, UTC). Returns null unless it is a real
 * calendar instant (30 February is not).
 */
export function parseTimestamp(ts) {
  const match = TS.exec(String(ts ?? ''));
  if (!match) return null;
  const [y, mo, d, hh, mm, ss] = match.slice(1).map(Number);
  if (mo < 1 || mo > 12 || hh > 23 || mm > 59 || ss > 59) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

const tsFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const tsShort = new Intl.DateTimeFormat(LOCALE, {
  timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** "20 Oct 2025, 03:17:57 UTC"; the raw text when it is not a valid instant. */
export function formatTimestamp(ts, { short = false } = {}) {
  const date = parseTimestamp(ts);
  if (!date) return String(ts ?? '');
  return `${(short ? tsShort : tsFormat).format(date)} UTC`;
}

/** ISO 8601 → "20 Oct 2026, 13:34:08 UTC". */
export function formatIso(iso) {
  const date = new Date(String(iso ?? ''));
  if (Number.isNaN(date.getTime())) return String(iso ?? '');
  return `${tsFormat.format(date)} UTC`;
}

/** "a92d…ba79" for a 64-hex MAC. */
export function shortHash(hex, head = 4, tail = 4) {
  const value = String(hex ?? '');
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}\u{2026}${value.slice(-tail)}`;
}

/** IBAN masked the way Gatehouse masks it: first 4 + stars + last 4. */
export function maskIban(iban) {
  const value = String(iban ?? '').replace(/\s+/g, '').toUpperCase();
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`;
}

/** Card number masked as BIN + last 4 (PCI DSS display rule). */
export function maskPan(pan) {
  const digits = String(pan ?? '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length < 10) return '*'.repeat(digits.length);
  return `${digits.slice(0, 6)}${'*'.repeat(digits.length - 10)}${digits.slice(-4)}`;
}

/**
 * A memo with every card-like run of digits — 12 or more, with up to four
 * characters that are neither letters nor digits between any two (far
 * wider than the joiners ALZPANSC links, so this masks more, never less)
 * — masked down to its last 4, one character for one, so fixed-width
 * records stay aligned. TXNGUARD refuses card numbers in memos (E803), and
 * this page shows the refused ones — and any it missed — masked too.
 */
export function maskMemo(memo) {
  return String(memo ?? '').replace(/\d(?:[^0-9A-Za-z]{0,4}\d){11,}/g, (run) => {
    let keep = 4;
    let out = '';
    for (let i = run.length - 1; i >= 0; i -= 1) {
      const c = run[i];
      const digit = c >= '0' && c <= '9';
      out = (digit && keep <= 0 ? '*' : c) + out;
      if (digit) keep -= 1;
    }
    return out;
  });
}

// Characters that are invisible, reorder text, or end lines: C0/C1 controls,
// format characters (bidi overrides and isolates, zero-width joiners, BOM,
// soft hyphen) and the Unicode line/paragraph separators.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const INVISIBLE_ALL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const NAMED = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

/** Visible escape for one invisible character: "\n", "\u{202E}". */
export function escapeChar(ch) {
  if (Object.hasOwn(NAMED, ch)) return NAMED[ch];
  return `\\u{${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}}`;
}

export function hasInvisible(value) {
  return INVISIBLE.test(String(value ?? ''));
}

/** Replace every invisible / bidi / control character with a visible escape. */
export function escapeInvisible(value) {
  return String(value ?? '').replace(INVISIBLE_ALL, escapeChar);
}

/**
 * Split text into plain runs and escaped runs so the UI can render escapes
 * distinctly (Trojan Source can't reorder what is shown).
 * @returns {{ text: string, escaped: boolean }[]}
 */
export function splitInvisible(value) {
  const input = String(value ?? '');
  const out = [];
  let plain = '';
  for (const ch of input) {
    if (INVISIBLE.test(ch)) {
      if (plain) out.push({ text: plain, escaped: false });
      plain = '';
      out.push({ text: escapeChar(ch), escaped: true });
    } else {
      plain += ch;
    }
  }
  if (plain) out.push({ text: plain, escaped: false });
  return out;
}

export function plural(n, one, other) {
  return n === 1 ? one : other;
}

/** Title-case a lowercase token: "nonconforming" → "Nonconforming". */
export function capitalize(value) {
  const text = String(value ?? '');
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
