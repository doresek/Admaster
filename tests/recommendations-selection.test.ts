// Tests for resolveClientSelection — the agency-model selection resolver used by
// app/api/recommendations/route.ts. Selection must come from the active
// meta_connection when present, and fall back to the legacy meta_clients.selected_*
// columns when no connection row exists. Supabase is mocked.
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveClientSelection } from '@/lib/meta-connections';

// Minimal mock of the supabase query chain used by getActiveConnection:
// from(...).select(...).eq().eq().eq().order().limit().maybeSingle() -> { data }
function mockSupabase(connectionRow: any): SupabaseClient {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: connectionRow, error: null }),
  };
  return { from: () => chain } as unknown as SupabaseClient;
}

const USER = 'agency-user-1';

describe('resolveClientSelection', () => {
  it('reads selection from the active connection when one exists', async () => {
    const supabase = mockSupabase({
      id: 'conn-1',
      selected_page_id: 'page-from-connection',
      selected_ad_account_id: 'act-from-connection',
      status: 'connected',
    });
    const client = {
      id: 'client-1',
      selected_page_id: 'stale-legacy-page',
      selected_ad_account_id: 'stale-legacy-act',
    };

    const sel = await resolveClientSelection(supabase, client, USER);

    expect(sel.selected_page_id).toBe('page-from-connection');
    expect(sel.selected_ad_account_id).toBe('act-from-connection');
  });

  it('falls back to meta_clients.selected_* when no connection row exists', async () => {
    const supabase = mockSupabase(null);
    const client = {
      id: 'client-2',
      selected_page_id: 'legacy-page',
      selected_ad_account_id: 'legacy-act',
    };

    const sel = await resolveClientSelection(supabase, client, USER);

    expect(sel.selected_page_id).toBe('legacy-page');
    expect(sel.selected_ad_account_id).toBe('legacy-act');
  });

  it('returns nulls when there is neither a connection nor a legacy selection', async () => {
    const supabase = mockSupabase(null);
    const client = { id: 'client-3' };

    const sel = await resolveClientSelection(supabase, client, USER);

    expect(sel.selected_page_id).toBeNull();
    expect(sel.selected_ad_account_id).toBeNull();
  });

  it('treats a connection with empty selection as not-selected (does not fall back)', async () => {
    const supabase = mockSupabase({
      id: 'conn-2',
      selected_page_id: null,
      selected_ad_account_id: null,
      status: 'connected',
    });
    const client = {
      id: 'client-4',
      selected_page_id: 'legacy-page',
      selected_ad_account_id: 'legacy-act',
    };

    const sel = await resolveClientSelection(supabase, client, USER);

    // An active connection wins even when its selection is empty — this is what
    // surfaces the "not configured" recommendation for a freshly connected client.
    expect(sel.selected_page_id).toBeNull();
    expect(sel.selected_ad_account_id).toBeNull();
  });
});
