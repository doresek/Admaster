import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from './crypto';

// Fetch a meta_clients row by id and return its decrypted access token.
// Returns null if the client doesn't belong to the user or no encrypted token exists.
export async function getDecryptedMetaToken(
  supabase: SupabaseClient,
  clientId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('meta_clients')
    .select('token_encrypted')
    .eq('id', clientId)
    .eq('user_id', userId)
    .single();
  if (!data?.token_encrypted) return null;
  return decrypt(data.token_encrypted);
}
