// tests/anti-abuse/repeat-business.test.ts — detectRepeatBusiness over a fake
// Supabase client (meta_connections + meta_clients).
import { describe, it, expect } from 'vitest';
import { detectRepeatBusiness } from '@/lib/anti-abuse/repeat-business';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Build a fake Supabase whose `.eq(col, val)` resolves canned rows per table. */
function fakeSupabase(rows: Record<string, (col: string, val: string) => any[]>): SupabaseClient {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq(col: string, val: string) {
              const data = rows[table] ? rows[table](col, val) : [];
              return Promise.resolve({ data, error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe('detectRepeatBusiness', () => {
  it('flags a page id already linked to another account (meta_connections)', async () => {
    const sb = fakeSupabase({
      meta_connections: (col, val) =>
        col === 'selected_page_id' && val === 'PAGE1'
          ? [{ agency_user_id: 'other-user', client_id: 'client-x' }]
          : [],
      meta_clients: () => [],
    });
    const res = await detectRepeatBusiness(sb, { pageId: 'PAGE1' });
    expect(res.isRepeat).toBe(true);
    expect(res.matches).toEqual([
      { userId: 'other-user', clientId: 'client-x', source: 'meta_connections', matchedOn: 'pageId' },
    ]);
  });

  it('excludes the current owner (re-connecting your own page is not repeat)', async () => {
    const sb = fakeSupabase({
      meta_connections: () => [{ agency_user_id: 'me', client_id: 'client-x' }],
      meta_clients: () => [],
    });
    const res = await detectRepeatBusiness(sb, { pageId: 'PAGE1', excludeUserId: 'me' });
    expect(res.isRepeat).toBe(false);
    expect(res.matches).toHaveLength(0);
  });

  it('matches a business (ad-account) id and the legacy meta_clients table', async () => {
    const sb = fakeSupabase({
      meta_connections: () => [],
      meta_clients: (col, val) =>
        col === 'selected_ad_account_id' && val === 'ACT_9'
          ? [{ id: 'legacy-client', user_id: 'legacy-user' }]
          : [],
    });
    const res = await detectRepeatBusiness(sb, { businessId: 'ACT_9' });
    expect(res.isRepeat).toBe(true);
    expect(res.matches[0]).toEqual({
      userId: 'legacy-user', clientId: 'legacy-client', source: 'meta_clients', matchedOn: 'businessId',
    });
  });

  it('returns no match when neither id is provided', async () => {
    const sb = fakeSupabase({});
    expect(await detectRepeatBusiness(sb, {})).toEqual({ isRepeat: false, matches: [] });
  });

  it('degrades to no-match when a query throws (detection outage never blocks)', async () => {
    const sb = {
      from() { return { select() { return { eq() { throw new Error('boom'); } }; } }; },
    } as unknown as SupabaseClient;
    expect(await detectRepeatBusiness(sb, { pageId: 'PAGE1' })).toEqual({ isRepeat: false, matches: [] });
  });
});
