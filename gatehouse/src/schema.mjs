// SPDX-License-Identifier: Apache-2.0
// Structural validation of a batch request: types, lengths, character set,
// no unknown keys. Business rules (IBAN check digits, amounts, currencies...)
// are deliberately left to TXNGUARD — the legacy core is the source of truth
// and re-validates everything this layer accepts.

import { HttpError } from './http.mjs';

/** Field name → maximum length as submitted and the record width it maps to. */
const FIELDS = Object.freeze({
  id: { required: true, max: 12 },
  timestamp: { required: true, max: 14 },
  from: { required: true, max: 42, normalize: normalizeIban, width: 34 },
  to: { required: true, max: 42, normalize: normalizeIban, width: 34 },
  amount: { required: true, max: 18 },
  currency: { required: true, max: 3 },
  pan: { required: false, max: 23, normalize: stripSpaces, width: 19 },
  channel: { required: true, max: 3 },
  memo: { required: false, max: 40 },
});

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * @param {unknown} body  parsed JSON
 * @param {number} maxTransactions
 * @returns {Array<Record<string, string>>} normalized transactions
 */
export function validateBatch(body, maxTransactions) {
  if (!isPlainObject(body)) throw schemaError('Body must be a JSON object', 'body');
  for (const key of Object.keys(body)) {
    if (key !== 'transactions') throw schemaError(`Unknown key "${printable(key)}"`, printable(key));
  }
  const list = body.transactions;
  if (!Array.isArray(list)) throw schemaError('"transactions" must be an array', 'transactions');
  if (list.length > maxTransactions) {
    throw new HttpError(400, 'P-LIMIT', `At most ${maxTransactions} transactions per batch`, { field: 'transactions' });
  }
  if (list.length === 0) throw schemaError('"transactions" must not be empty', 'transactions');
  return list.map((item, index) => validateTransaction(item, index));
}

function validateTransaction(item, index) {
  const where = (field) => `transactions[${index}]${field ? `.${field}` : ''}`;
  if (!isPlainObject(item)) throw schemaError('Each transaction must be an object', where(), index);
  for (const key of Object.keys(item)) {
    if (!Object.hasOwn(FIELDS, key)) {
      throw schemaError(`Unknown key "${printable(key)}"`, where(printable(key)), index);
    }
  }
  /** @type {Record<string, string>} */
  const out = Object.create(null);
  for (const [name, rule] of Object.entries(FIELDS)) {
    const value = item[name];
    if (value === undefined) {
      if (rule.required) throw schemaError(`Missing "${name}"`, where(name), index);
      out[name] = '';
      continue;
    }
    if (typeof value !== 'string') throw schemaError(`"${name}" must be a string`, where(name), index);
    if (value.length > rule.max) {
      throw new HttpError(400, 'P-LENGTH', `"${name}" is longer than ${rule.max} characters`, { field: where(name), index });
    }
    if (!PRINTABLE_ASCII.test(value)) {
      throw new HttpError(400, 'P-CHARSET', `"${name}" must be printable ASCII (no control or non-ASCII characters)`, {
        field: where(name),
        index,
      });
    }
    const normalized = rule.normalize ? rule.normalize(value) : value;
    if (rule.width !== undefined && normalized.length > rule.width) {
      throw new HttpError(400, 'P-LENGTH', `"${name}" is longer than ${rule.width} characters`, { field: where(name), index });
    }
    out[name] = normalized;
  }
  return out;
}

/** IBANs are case-insensitive and printed in groups of four. */
function normalizeIban(value) {
  return value.replaceAll(' ', '').toUpperCase();
}

function stripSpaces(value) {
  return value.replaceAll(' ', '');
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaError(message, field, index) {
  return new HttpError(400, 'P-SCHEMA', message, index === undefined ? { field } : { field, index });
}

/** Echo user-supplied key names safely (bounded, printable). */
function printable(text) {
  return text.replace(/[^\x20-\x7e]/g, '?').slice(0, 40);
}
