import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// 32-byte key derived from ENCRYPTION_KEY env var (any length string).
// Set ENCRYPTION_KEY to a long random secret in production (>= 32 chars).
function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error('ENCRYPTION_KEY env var must be set and >= 32 chars');
  }
  return scryptSync(secret, 'admaster-pro-salt', 32);
}

// AES-256-GCM: returns base64(iv|tag|ciphertext)
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// Backward-compat read helper: decrypt() a value produced by encrypt(), but if
// the value is NOT in our AES-GCM format (e.g. a token written before
// encryption rolled out), return it unchanged as plaintext. The GCM auth tag
// makes a false-positive decrypt essentially impossible — a plaintext value
// fails authentication and throws, so we safely fall through to plaintext.
export function decryptOrPlaintext(value: string): string {
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

// True iff `value` is in our AES-GCM format (i.e. produced by encrypt()).
// Used by the backfill to skip already-encrypted rows idempotently. Relies on
// the GCM auth tag: a plaintext value fails authentication and throws.
export function isEncrypted(value: string): boolean {
  try {
    decrypt(value);
    return true;
  } catch {
    return false;
  }
}
