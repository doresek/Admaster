// Backfill decision logic: plaintext → encrypted, already-encrypted → skip.
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-at-least-32-chars-long';

import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '@/lib/crypto';
import { planTokenEncryption, tallyMigration } from '@/scripts/backfill-encrypt-meta-tokens';

const TOKEN = 'EAAB-legacy-meta-access-token_value-999';

describe('planTokenEncryption (backfill, idempotent)', () => {
  it('encrypts a legacy plaintext token (token column) into token_encrypted', () => {
    const next = planTokenEncryption({ id: 'c1', token: TOKEN, token_encrypted: null });
    expect(next).toBeTruthy();
    expect(next).not.toEqual(TOKEN);
    expect(decrypt(next!)).toEqual(TOKEN);     // recoverable ciphertext
  });

  it('skips a row already encrypted (idempotent)', () => {
    const row = { id: 'c1', token: null, token_encrypted: encrypt(TOKEN) };
    expect(planTokenEncryption(row)).toBeNull();
  });

  it('encrypts plaintext that wrongly landed in token_encrypted', () => {
    const next = planTokenEncryption({ id: 'c1', token: null, token_encrypted: TOKEN });
    expect(next).toBeTruthy();
    expect(decrypt(next!)).toEqual(TOKEN);
  });

  it('skips a row with no token at all', () => {
    expect(planTokenEncryption({ id: 'c1', token: null, token_encrypted: null })).toBeNull();
  });
});

describe('tallyMigration (mixed batch)', () => {
  it('counts migrated / skipped / failed / total and only writes plaintext rows', async () => {
    const rows = [
      { id: 'plain1', token: 'T1', token_encrypted: null },         // → migrate (ok)
      { id: 'enc1', token: null, token_encrypted: encrypt('T2') },  // → skip (already encrypted)
      { id: 'empty1', token: null, token_encrypted: null },         // → skip (no token)
      { id: 'failrow', token: 'T3', token_encrypted: null },        // → migrate (write fails)
    ];

    const writes: Array<{ id: string; value: string }> = [];
    const writeEncrypted = async (id: string, value: string) => {
      if (id === 'failrow') return { error: { message: 'update failed' } };
      writes.push({ id, value });
      return { error: null };
    };

    const tally = await tallyMigration(rows, writeEncrypted);

    expect(tally).toEqual({ migrated: 1, skipped: 2, failed: 1, total: 4 });
    // only the successful plaintext row was actually written, with a real ciphertext
    expect(writes).toHaveLength(1);
    expect(writes[0].id).toBe('plain1');
    expect(decrypt(writes[0].value)).toBe('T1');
  });
});
