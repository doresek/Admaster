import type { SupabaseClient } from '@supabase/supabase-js';

// ════════════════════════════════════════════
// meta_connections — the per-(client, agency-user) credential/asset record.
//
// `meta_clients` is now pure identity (name, industry, emoji, stats). Each Meta
// OAuth connect inserts a child `meta_connections` row owning the encrypted
// token, the connected account's Pages + ad accounts, and the active
// page/ad-account selection. One client can own many connections (agency
// model); the active one is the most-recently-connected row with
// status='connected'.
//
// RLS: meta_connections_own = auth.uid() = agency_user_id.
// ════════════════════════════════════════════

export interface MetaConnectionRow {
  id: string;
  token_encrypted: string | null;
  pages: any[];
  ad_accounts: any[];
  selected_page_id: string | null;
  selected_ad_account_id: string | null;
  status: 'pending' | 'connected' | 'error' | 'revoked';
}

// Resolve the active connection for a client owned by an agency user: the most
// recently connected row with status='connected'. Returns null when none
// exists (e.g. a client that predates the meta_connections backfill, or one
// that has never completed an OAuth connect).
export async function getActiveConnection(
  supabase: SupabaseClient,
  clientId: string,
  agencyUserId: string,
): Promise<MetaConnectionRow | null> {
  const { data } = await supabase
    .from('meta_connections')
    .select('id, token_encrypted, pages, ad_accounts, selected_page_id, selected_ad_account_id, status')
    .eq('client_id', clientId)
    .eq('agency_user_id', agencyUserId)
    .eq('status', 'connected')
    .order('connected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ?? null;
}
