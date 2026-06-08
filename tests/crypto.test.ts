// Token-at-rest encryption: round-trip + plaintext backward-compat fallback.
// ENCRYPTION_KEY must be set before importing the module under test, since
// getKey() reads it lazily per call.
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-at-least-32-chars-long';

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, decryptOrPlaintext } from '@/lib/crypto';

const TOKEN = 'EAAB1xY2zMeta|long.access-token_value-123';

describe('crypto encrypt/decrypt', () => {
  it('round-trips a token through encrypt → decrypt', () => {
    const enc = encrypt(TOKEN);
    expect(enc).not.toEqual(TOKEN);          // actually transformed
    expect(decrypt(enc)).toEqual(TOKEN);     // recovered exactly
  });

  it('produces a different ciphertext each call (random IV)', () => {
    expect(encrypt(TOKEN)).not.toEqual(encrypt(TOKEN));
  });
});

describe('decryptOrPlaintext (backward-compat)', () => {
  it('decrypts a value produced by encrypt()', () => {
    expect(decryptOrPlaintext(encrypt(TOKEN))).toEqual(TOKEN);
  });

  it('returns a legacy plaintext token unchanged (not in encrypted format)', () => {
    expect(decryptOrPlaintext(TOKEN)).toEqual(TOKEN);
  });

  it('falls back to plaintext for arbitrary non-encrypted input', () => {
    expect(decryptOrPlaintext('plain-string')).toEqual('plain-string');
    expect(decryptOrPlaintext('')).toEqual('');
  });
});
