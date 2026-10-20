/**
 * Identifier heuristics ("does this name look like money / a secret?").
 * Matching is done on the words of a name (split on '-' and '_') so that
 * SPINDLE is not a PIN and CHECKSUM is not a SUM. Words that describe
 * metadata about a value (its length, count, status, mask...) turn the
 * match off, which keeps idiomatic secure code free of false positives.
 */
import { hasPartSequence, nameParts } from './text.mjs';

/** Words meaning "data about the value", not the value itself. */
const META_PARTS = new Set([
  'LEN', 'LENGTH', 'SIZE', 'COUNT', 'CNT', 'CTR', 'COUNTER', 'IDX', 'INDEX', 'POS', 'PTR', 'MAX', 'MIN',
  'STATUS', 'STAT', 'FLAG', 'FLG', 'SW', 'SWITCH', 'TYPE', 'KIND', 'PROMPT', 'MSG', 'MESSAGE', 'LABEL',
  'HDR', 'HEADER', 'HEADING', 'TITLE', 'TEXT', 'TXT', 'EXPIRY', 'TTL', 'TIMEOUT', 'ATTEMPTS', 'TRIES',
  'RETRIES', 'MASK', 'MASKED', 'REDACTED', 'LAST4', 'BIN', 'OK', 'VALID', 'ERR', 'ERROR', 'RC', 'IND',
  'FMT', 'FORMAT', 'NAME', 'POLICY', 'RULE', 'FIELD', 'ENV', 'VAR', 'FILE', 'PATH', 'DSN', 'KEYWORD',
  'PREFIX', 'ID', 'HINT', 'CHARS', 'CHARSET', 'ALPHABET', 'UNIT', 'IOS', 'IOSTAT', 'ALG', 'ALGO',
  'ALGORITHM', 'MODE',
]);

/** Fortran adds count-style prefixes such as n_token or token_nbytes. */
const FORTRAN_META_PARTS = new Set([...META_PARTS, 'N', 'NUM', 'NBYTES', 'NCHARS', 'NB']);

/** Extra words that, for money, mean "an identifier or date", not an amount. */
const MONEY_META_PARTS = new Set([
  ...FORTRAN_META_PARTS, 'CODE', 'CD', 'NO', 'NBR', 'SEQ', 'DATE', 'DT', 'TIME', 'YEAR', 'YR', 'MONTH',
  'DAY', 'DAYS', 'DESC', 'SUBSCRIPT',
]);

/** Words that almost always mean money. */
const COBOL_MONEY_STRONG = new Set([
  'AMT', 'AMTS', 'AMOUNT', 'AMOUNTS', 'BAL', 'BALS', 'BALANCE', 'BALANCES', 'PRICE', 'PRICES', 'FEE', 'FEES',
  'INTEREST', 'PAY', 'PAYMENT', 'PAYMENTS', 'GROSSPAY', 'NETPAY', 'SALARY', 'SALARIES', 'TAX', 'TAXES',
  'CREDIT', 'CREDITS', 'DEBIT', 'DEBITS', 'CENTS',
]);

/**
 * Words that mean money only for a field with decimal places: a TOTAL,
 * SUM, RATE or LIMIT without cents is usually a count (record totals,
 * Luhn digit sums, retry limits).
 */
const COBOL_MONEY_WEAK = new Set([
  'TOTAL', 'TOTALS', 'TOT', 'SUBTOTAL', 'GRANDTOTAL', 'SUM', 'SUMS', 'RATE', 'RATES', 'LIMIT', 'LIMITS',
]);

const FORTRAN_MONEY = new Set([
  'AMOUNT', 'AMOUNTS', 'BALANCE', 'BALANCES', 'PRICE', 'PRICES', 'FEE', 'FEES', 'INTEREST', 'SALARY',
  'SALARIES', 'TAX', 'TAXES', 'PAYMENT', 'PAYMENTS', 'CENTS',
]);

/**
 * @param {string[]} parts
 * @param {Set<string>} meta
 */
function hasMeta(parts, meta) {
  return parts.some((part) => meta.has(part));
}

/**
 * How strongly a COBOL name suggests money (rules 009, 011, 013):
 * 'strong' (AMOUNT, BALANCE, FEE...), 'weak' (TOTAL, SUM, RATE, LIMIT:
 * money only when the field has decimal places) or null.
 * @param {string} name
 * @returns {'strong'|'weak'|null}
 */
export function cobolMoneyStrength(name) {
  const parts = nameParts(name);
  if (hasMeta(parts, MONEY_META_PARTS)) return null;
  if (parts.some((part) => COBOL_MONEY_STRONG.has(part))) return 'strong';
  return parts.some((part) => COBOL_MONEY_WEAK.has(part)) ? 'weak' : null;
}

/**
 * Fortran variable names that hold money (rule ALZ-FOR-010). Generic words
 * such as total or cost (cost functions) are not enough on their own.
 * @param {string} name
 * @returns {boolean}
 */
export function isFortranMonetaryName(name) {
  const parts = nameParts(name);
  return !hasMeta(parts, MONEY_META_PARTS) && parts.some((part) => FORTRAN_MONEY.has(part));
}

/**
 * COBOL fields whose content must not be displayed (ALZ-COB-005).
 * @param {string} name
 * @returns {boolean}
 */
export function isCobolSensitiveName(name) {
  const parts = nameParts(name);
  if (hasMeta(parts, META_PARTS)) return false;
  if (hasPartSequence(parts, ['CARD', 'NUM']) || hasPartSequence(parts, ['CARD', 'NO'])
    || hasPartSequence(parts, ['CARD', 'NUMBER']) || hasPartSequence(parts, ['CARD', 'NBR'])) return true;
  return parts.some((part) => part === 'PAN' || part === 'PANS' || part === 'CARDNO' || part === 'CARDNUM'
    || part === 'CARDNUMBER' || part === 'CCNUM' || part === 'CCNO'
    || part.startsWith('CVV') || part.startsWith('CVC') || part === 'SSN' || isPinWord(part)
    || part.startsWith('IBAN') || part.includes('PASSWORD') || part.includes('PASSWD')
    || part.includes('SECRET') || part.startsWith('TOKEN') || part.endsWith('TOKEN'));
}

/**
 * PIN, PINS, PIN2, PINCODE, PINBLOCK (but not SPINDLE or PINE).
 * @param {string} part
 * @returns {boolean}
 */
function isPinWord(part) {
  if (!part.startsWith('PIN')) return false;
  const rest = part.slice(3);
  if (rest === '' || rest === 'S' || rest === 'CODE' || rest === 'BLOCK' || rest === 'BLK') return true;
  for (let i = 0; i < rest.length; i++) {
    const code = rest.charCodeAt(i);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

/**
 * COBOL items that hold credentials (ALZ-COB-004).
 * @param {string} name
 * @returns {{ match: boolean, pin: boolean }}
 */
export function cobolCredentialKind(name) {
  const parts = nameParts(name);
  if (hasMeta(parts, META_PARTS)) return { match: false, pin: false };
  const pin = parts.length > 0 && isPinWord(parts[parts.length - 1]);
  const passwordLike = parts.some((part) => part.includes('PASSWORD') || part.includes('PASSWD')
    || part.includes('PWD') || part.includes('PASSPHRASE'));
  const match = pin || passwordLike || parts.some((part) => part.includes('SECRET') || part.includes('TOKEN')
    || part === 'APIKEY' || part.includes('CREDENTIAL'))
    || hasPartSequence(parts, ['API', 'KEY']) || hasPartSequence(parts, ['PRIVATE', 'KEY']);
  return { match, pin: pin || passwordLike };
}

/**
 * Fortran names of secrets compared with == (ALZ-FOR-008).
 * @param {string} name
 * @returns {boolean}
 */
export function isFortranSecretName(name) {
  const parts = nameParts(name);
  if (hasMeta(parts, FORTRAN_META_PARTS)) return false;
  if (hasPartSequence(parts, ['API', 'KEY'])) return true;
  return parts.some((part) => part.includes('PASSWORD') || part.includes('PASSWD') || part.includes('SECRET')
    || part.includes('APIKEY') || part.includes('PASSPHRASE') || part.startsWith('TOKEN') || part.endsWith('TOKEN')
    || part.includes('HMAC') || part === 'MAC' || part === 'MACS' || part.startsWith('SIGNATURE')
    || part.startsWith('DIGEST') || part === 'OTP' || part === 'TOTP' || part === 'HOTP');
}

/**
 * Fortran names of credentials initialised with literals (ALZ-FOR-009).
 * @param {string} name
 * @returns {boolean}
 */
export function isFortranCredentialName(name) {
  const parts = nameParts(name);
  if (hasMeta(parts, FORTRAN_META_PARTS)) return false;
  if (hasPartSequence(parts, ['API', 'KEY'])) return true;
  return parts.some((part) => part.includes('PASSWORD') || part.includes('PASSWD') || part.includes('SECRET')
    || part.startsWith('TOKEN') || part.endsWith('TOKEN') || part.includes('APIKEY')
    || part.includes('CREDENTIAL') || part.includes('PASSPHRASE'));
}

const KEY_COMPOUNDS = new Set(['KEY', 'KEYS', 'APIKEY', 'PRIVKEY', 'PRIVATEKEY', 'HMACKEY', 'AESKEY', 'SECKEY', 'ENCKEY', 'MACKEY']);

/**
 * Words that show a procedure deals with secrets (context for ALZ-FOR-012).
 * @param {string} word
 * @returns {boolean}
 */
export function isSecretContextWord(word) {
  for (const part of nameParts(word)) {
    if (KEY_COMPOUNDS.has(part) || part.startsWith('TOKEN') || part.endsWith('TOKEN') || part.startsWith('NONCE')
      || part === 'SALT' || part === 'SALTS' || part.includes('PASSWORD') || part.includes('PASSWD')
      || part.includes('SECRET') || part === 'OTP' || part.startsWith('SESSION') || part === 'IV') return true;
  }
  return false;
}
