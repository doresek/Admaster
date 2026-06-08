import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptOrPlaintext } from './crypto';

// Fetch a meta_clients row by id and return its decrypted access token.
//
// Backward-compat: migration 003 added `token_encrypted` and kept the legacy
// plaintext `token` column for rows connected before encryption rolled out.
// New rows populate only token_encrypted; legacy rows have only token. We read
// either — decryptOrPlaintext is a permanent safety net so a value that isn't
// in encrypted format still works. This path is strictly read-only; legacy
// plaintext rows are migrated off plaintext by scripts/backfill-encrypt-meta-tokens.ts.
//
// Returns null only when the client doesn't belong to the user or has no token.
export async function getDecryptedMetaToken(
  supabase: SupabaseClient,
  clientId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('meta_clients')
    .select('token_encrypted, token')
    .eq('id', clientId)
    .eq('user_id', userId)
    .single();
  if (!data) return null;

  // Preferred path: encrypted column. decryptOrPlaintext tolerates a value that
  // somehow landed here unencrypted.
  if (data.token_encrypted) return decryptOrPlaintext(data.token_encrypted);

  // Legacy path: plaintext token column. Return as-is (read-only).
  if (data.token) return data.token as string;

  return null;
}
