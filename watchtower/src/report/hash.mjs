/**
 * FNV-1a 64-bit hash (BigInt), used for stable SARIF fingerprints.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;
const encoder = new TextEncoder();

/**
 * @param {string} text
 * @returns {string} 16 lower-case hex digits
 */
export function fnv1a64(text) {
  let hash = FNV_OFFSET;
  for (const byte of encoder.encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Collapse every run of whitespace to one space and trim.
 * @param {string} text
 * @returns {string}
 */
export function normalizeWhitespace(text) {
  let out = '';
  let pendingSpace = false;
  for (const ch of text) {
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
      pendingSpace = out.length > 0;
    } else {
      if (pendingSpace) out += ' ';
      pendingSpace = false;
      out += ch;
    }
  }
  return out;
}

/**
 * Fingerprint of a finding: rule id + whitespace-normalised source line.
 * @param {string} ruleId
 * @param {string} lineText
 * @returns {string}
 */
export function lineHash(ruleId, lineText) {
  return fnv1a64(`${ruleId}:${normalizeWhitespace(lineText)}`);
}
