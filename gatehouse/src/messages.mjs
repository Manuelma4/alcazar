// SPDX-License-Identifier: Apache-2.0
// English texts for TXNGUARD reason codes (docs/ARCHITECTURE.md, section 3).

export const REASONS = Object.freeze({
  E101: 'Transaction id is empty or uses characters outside A-Z 0-9 -',
  E102: 'Transaction id already used in this batch (replay)',
  E201: 'Timestamp is not a valid calendar date and time',
  E202: 'Timestamp is more than one day in the future',
  E301: 'Sender IBAN has a bad format or the wrong length for its country',
  E302: 'Sender IBAN check digits fail (ISO 7064 MOD 97-10)',
  E303: 'Beneficiary IBAN has a bad format or the wrong length for its country',
  E304: 'Beneficiary IBAN check digits fail (ISO 7064 MOD 97-10)',
  E305: 'Sender and beneficiary are the same account',
  E401: 'Amount is not a decimal with at most two places',
  E402: 'Amount has more than 13 integer digits and would be truncated',
  E403: 'Amount is zero or negative',
  E404: 'Amount is above the single-transfer limit of 1,000,000.00',
  E501: 'Currency is not on the allowlist',
  E601: 'Card number is not 12 to 19 digits',
  E602: 'Card number fails the Luhn check',
  E701: 'Unknown channel',
  E801: 'Memo contains characters outside the SEPA character set',
  E802: 'Memo starts with a spreadsheet formula character',
  E901: 'Record contains control or non-ASCII bytes',
});

export function reasonText(code) {
  return Object.hasOwn(REASONS, code) ? REASONS[code] : 'Rejected';
}
