// getDecryptedMetaToken resolution order:
//   1. active meta_connections row (encrypted token) — the primary path;
//   2. LEGACY FALLBACK to meta_clients (encrypted column, then plaintext) when
//      no connection exists (read-only, NO write-back);
//   3. null when neither yields a token.
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-at-least-32-chars-long';

import { describe, it, expect } from 'vitest';
import { encrypt } from '@/lib/crypto';
import { getDecryptedMetaToken } from '@/lib/meta';

const TOKEN = 'EAAB-legacy-meta-access-token_value-999';
const CONN_TOKEN = 'EAAB-connection-meta-access-token_value-111';

// Minimal table-aware Supabase stub. `from(table)` returns a chainable that
// resolves to that table's row. meta_connections terminates with .maybeSingle()
// (after .order().limit()); meta_clients terminates with .single(). `updates`
// records any write so a test can assert NONE happens on the read path.
function makeSupabase(rows: {
  meta_connections?: Record<string, unknown> | null;
  meta_clients?: Record<string, unknown> | null;
}) {
  const updates: Array<Record<string, unknown>> = [];
  const supabase = {
    from(table: 'meta_connections' | 'meta_clients') {
      const row = rows[table] ?? null;
      return {
        select() { return this; },
        update(values: Record<string, unknown>) { updates.push(values); return this; },
        eq() { return this; },
        order() { return this; },
        limit() { return this; },
        maybeSingle() { return Promise.resolve({ data: row, error: null }); },
        single() { return Promise.resolve({ data: row, error: null }); },
      };
    },
  } as any;
  return { supabase, updates };
}

describe('getDecryptedMetaToken', () => {
  it('decrypts the active connection token (primary path)', async () => {
    const { supabase } = makeSupabase({
      meta_connections: { token_encrypted: encrypt(CONN_TOKEN), status: 'connected' },
      meta_clients: { token_encrypted: encrypt(TOKEN), token: null },
    });
    // connection wins over the legacy client row
    expect(await getDecryptedMetaToken(supabase, 'c1', 'u1')).toEqual(CONN_TOKEN);
  });

  it('falls back to meta_clients token_encrypted when no connection exists', async () => {
    const { supabase } = makeSupabase({
      meta_connections: null,
      meta_clients: { token_encrypted: encrypt(TOKEN), token: null },
    });
    expect(await getDecryptedMetaToken(supabase, 'c1', 'u1')).toEqual(TOKEN);
  });

  it('returns a legacy plaintext token on read with NO write-back', async () => {
    const { supabase, updates } = makeSupabase({
      meta_connections: null,
      meta_clients: { token_encrypted: null, token: TOKEN },
    });
    const result = await getDecryptedMetaToken(supabase, 'c1', 'u1');
    expect(result).toEqual(TOKEN);
    // reads are strictly read-only — migration is the backfill script's job
    expect(updates).toHaveLength(0);
  });

  it('returns null when neither a connection nor a client token exists', async () => {
    const { supabase } = makeSupabase({
      meta_connections: null,
      meta_clients: { token_encrypted: null, token: null },
    });
    expect(await getDecryptedMetaToken(supabase, 'c1', 'u1')).toBeNull();
  });

  it('returns null when the client is not found', async () => {
    const { supabase } = makeSupabase({ meta_connections: null, meta_clients: null });
    expect(await getDecryptedMetaToken(supabase, 'c1', 'u1')).toBeNull();
  });
});
