import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptOrPlaintext } from './crypto';
import { getActiveConnection } from './meta-connections';

// Resolve a client's decrypted Meta access token.
//
// Primary path: the active `meta_connections` row (the credential record in the
// agency model — one client can own many connections). Its `token_encrypted`
// is decrypted with the same lib/crypto AES-256-GCM format used to store it.
//
// LEGACY FALLBACK: clients connected before the meta_connections backfill have
// no connection row; for those we fall back to the old `meta_clients` columns
// (`token_encrypted`, or the legacy plaintext `token`). decryptOrPlaintext is a
// permanent safety net so a value that isn't in encrypted format still works.
// This path is strictly read-only.
//
// Returns null only when neither a connection nor a legacy client token exists
// for (clientId, userId).
export async function getDecryptedMetaToken(
  supabase: SupabaseClient,
  clientId: string,
  userId: string,
): Promise<string | null> {
  // Primary: active meta_connections row.
  const connection = await getActiveConnection(supabase, clientId, userId);
  if (connection?.token_encrypted) return decryptOrPlaintext(connection.token_encrypted);

  // Legacy fallback: meta_clients credential columns (pre-backfill rows).
  const { data } = await supabase
    .from('meta_clients')
    .select('token_encrypted, token')
    .eq('id', clientId)
    .eq('user_id', userId)
    .single();
  if (!data) return null;

  if (data.token_encrypted) return decryptOrPlaintext(data.token_encrypted);
  if (data.token) return data.token as string;

  return null;
}
