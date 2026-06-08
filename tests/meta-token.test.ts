// getDecryptedMetaToken: encrypted-column path, legacy plaintext-column path
// (read-only, NO write-back), and the not-found case.
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-at-least-32-chars-long';

import { describe, it, expect } from 'vitest';
import { encrypt } from '@/lib/crypto';
import { getDecryptedMetaToken } from '@/lib/meta';

const TOKEN = 'EAAB-legacy-meta-access-token_value-999';

// Minimal Supabase stub: one meta_clients row. The read path is select-only;
// `updates` records any write so a test can assert NONE happens.
function makeSupabase(row: Record<string, unknown> | null) {
  const updates: Array<Record<string, unknown>> = [];
  const supabase = {
    from() {
      return {
        select() { return this; },
        update(values: Record<string, unknown>) { updates.push(values); return this; },
        eq() { return this; },
        single() { return Promise.resolve({ data: row, error: null }); },
        then(resolve: (v: { data: null; error: null }) => unknown) {
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
    },
  } as any;
  return { supabase, updates };
}

describe('getDecryptedMetaToken', () => {
  it('decrypts the token_encrypted column', async () => {
    const { supabase } = makeSupabase({ token_encrypted: encrypt(TOKEN), token: null });
    expect(await getDecryptedMetaToken(supabase, 'c1', 'u1')).toEqual(TOKEN);
  });

  it('returns a legacy plaintext token on read with NO write-back', async () => {
    const { supabase, updates } = makeSupabase({ token_encrypted: null, token: TOKEN });
    const result = await getDecryptedMetaToken(supabase, 'c1', 'u1');
    expect(result).toEqual(TOKEN);
    // reads are strictly read-only — migration is the backfill script's job
    expect(updates).toHaveLength(0);
  });

  it('returns null when the row has no token at all', async () => {
    const { supabase } = makeSupabase({ token_encrypted: null, token: null });
    expect(await getDecryptedMetaToken(supabase, 'c1', 'u1')).toBeNull();
  });

  it('returns null when the client is not found', async () => {
    const { supabase } = makeSupabase(null);
    expect(await getDecryptedMetaToken(supabase, 'c1', 'u1')).toBeNull();
  });
});
