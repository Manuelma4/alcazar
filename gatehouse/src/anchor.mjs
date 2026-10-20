// SPDX-License-Identifier: Apache-2.0
// Signed anchors. The HMAC chain shows that nobody without K_ledger changed a
// ledger — but K_ledger seals as well as verifies, so whoever holds it (an
// auditor included) could seal a ledger of their own. What TXNGUARD reported
// when it sealed a job — job id, entry count, head MAC — is therefore also
// signed, with an Ed25519 key only Gatehouse holds: auditors get the public
// key, which verifies and cannot sign.

import { createHash, createHmac, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

export const ANCHOR_SCHEMA = 'alcazar.anchor/v1';

// RFC 8410 DER wrappings of a raw Ed25519 private seed and public key.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

export class AnchorError extends Error {}

const keyId = (raw) => createHash('sha256').update(raw).digest('hex').slice(0, 16);

/**
 * Gatehouse's signing key, derived like the sub-keys:
 * seed = HMAC-SHA256(master, "alcazar/anchor/v1" || 0x01).
 */
export function anchorSigner(masterKey) {
  const seed = createHmac('sha256', masterKey).update(Buffer.from('alcazar/anchor/v1\x01', 'latin1')).digest();
  const der = Buffer.concat([PKCS8_ED25519, seed]);
  try {
    const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const raw = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(SPKI_ED25519.length);
    return { privateKey, publicKey: raw.toString('base64url'), keyId: keyId(raw) };
  } finally {
    seed.fill(0);
    der.fill(0);
  }
}

/** The exact bytes signed: one field per line, in this order. */
export function anchorStatement({ job, entries, head, sealedAt }) {
  return Buffer.from(`${ANCHOR_SCHEMA}\njob=${job}\nentries=${entries}\nhead=${head}\nsealedAt=${sealedAt}\n`, 'latin1');
}

export function signAnchor(signer, { job, entries, head, sealedAt }) {
  const signature = sign(null, anchorStatement({ job, entries, head, sealedAt }), signer.privateKey).toString('base64url');
  return { schema: ANCHOR_SCHEMA, job, entries, head, sealedAt, keyId: signer.keyId, signature };
}

/**
 * Check an anchor document (parsed JSON) against a public key given out of
 * band — never the one a document could name. Returns its fields, or throws
 * AnchorError.
 */
export function verifyAnchor(doc, publicKey) {
  const fields = doc !== null && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  if (fields.schema !== ANCHOR_SCHEMA) throw new AnchorError(`not an ${ANCHOR_SCHEMA} document`);
  const { job, entries, head, sealedAt, signature } = fields;
  if (typeof job !== 'string' || !/^[a-z0-9-]{1,32}$/.test(job)) throw new AnchorError('bad job id');
  if (!Number.isInteger(entries) || entries < 0 || entries > 999_999) throw new AnchorError('bad entry count');
  if (typeof head !== 'string' || !/^[0-9a-f]{64}$/.test(head)) throw new AnchorError('bad head');
  if (typeof sealedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(sealedAt)) throw new AnchorError('bad sealing time');
  if (typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) throw new AnchorError('bad signature');
  const raw = typeof publicKey === 'string' && /^[A-Za-z0-9_-]{43}$/.test(publicKey) ? Buffer.from(publicKey, 'base64url') : null;
  if (!raw || raw.length !== 32) throw new AnchorError('the public key must be 32 bytes, base64url');
  const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' });
  if (!verify(null, anchorStatement({ job, entries, head, sealedAt }), key, Buffer.from(signature, 'base64url'))) {
    throw new AnchorError('the signature does not match: this anchor was not signed by that key, or was changed');
  }
  return { job, entries, head, sealedAt, keyId: keyId(raw) };
}
