// Deterministic synthetic cryptography for the authored F8 copy rehearsal.
// This is not an AWS KMS emulator or a production key-management scheme.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digestBytes = (bytes) => createHash('sha256').update(bytes).digest();
const encryptionKey = (keyRef) => digestBytes(`f8-v22-authored-envelope:${keyRef}`);

export function sealBytes(bytes, keyRef, context) {
  const iv = digestBytes(`f8-v22-authored-nonce:${keyRef}:${context}`).subarray(0, 12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(keyRef), iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm',
    key_ref: keyRef,
    iv_b64: iv.toString('base64'),
    ciphertext_b64: ciphertext.toString('base64'),
    tag_b64: cipher.getAuthTag().toString('base64'),
  };
}

export function openBytes(envelope, keyRef) {
  if (envelope.algorithm !== 'aes-256-gcm' || envelope.key_ref !== keyRef) {
    throw new Error('ciphertext key binding mismatch');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(keyRef),
    Buffer.from(envelope.iv_b64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag_b64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext_b64, 'base64')),
    decipher.final(),
  ]);
}

const seed = digestBytes('f8-v22-authored-operator-signing-seed');
const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  format: 'der',
  type: 'pkcs8',
});
const publicKey = createPublicKey(privateKey);

export function signGrant(grant) {
  return {
    ...grant,
    signature_b64: sign(null, Buffer.from(JSON.stringify(grant)), privateKey).toString('base64'),
  };
}

export function verifyGrant(signedGrant) {
  const { signature_b64: signature, ...grant } = signedGrant;
  return (
    typeof signature === 'string' &&
    verify(null, Buffer.from(JSON.stringify(grant)), publicKey, Buffer.from(signature, 'base64'))
  );
}
