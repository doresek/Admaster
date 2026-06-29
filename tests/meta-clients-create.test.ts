// Tests for POST /api/meta/clients — the brief-first client-creation entry.
//
// Locks two paths of the real route handler against a mocked Supabase + a
// mocked encrypt() + a stubbed global fetch:
//   1. NAME ONLY (no token) → identity-only insert, status 'new', no Meta
//      verification calls, null token_encrypted/meta_*; pages/ad_accounts empty.
//   2. NAME + TOKEN → existing behavior preserved: verifies via /me,
//      /me/accounts, /me/adaccounts, encrypts the token, status 'connected'.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  authUser: { id: 'owner-1' } as { id: string } | null,
  insertPayload: undefined as any,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: H.authUser } }) },
    from(_table: string) {
      const builder: any = {
        insert: (p: any) => { H.insertPayload = p; return builder; },
        select: () => builder,
        single: async () => ({ data: { id: 'new-client-id', ...H.insertPayload }, error: null }),
      };
      return builder;
    },
  }),
}));

vi.mock('@/lib/crypto', () => ({
  encrypt: (plain: string) => `enc(${plain})`,
}));

import { POST } from '@/app/api/meta/clients/route';

const req = (body: any) => ({ json: async () => body }) as any;

beforeEach(() => {
  H.authUser = { id: 'owner-1' };
  H.insertPayload = undefined;
  vi.restoreAllMocks();
});

describe('POST /api/meta/clients — name only (brief-first)', () => {
  it('inserts an identity-only client with status "new" and NO Meta calls', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch' as any);

    const res = await POST(req({ name: 'Acme', industry: 'spa', emoji: '💎' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled(); // no token verification path

    expect(H.insertPayload).toMatchObject({
      user_id: 'owner-1',
      name: 'Acme',
      industry: 'spa',
      emoji: '💎',
      token_encrypted: null,
      meta_user_id: null,
      meta_user_name: null,
      pages: [],
      ad_accounts: [],
      selected_page_id: null,
      selected_ad_account_id: null,
      status: 'new',
    });
    expect(data.id).toBe('new-client-id');
  });

  it('400s when name is missing', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch' as any);
    const res = await POST(req({ industry: 'spa' }));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('401s when unauthenticated', async () => {
    H.authUser = null;
    const res = await POST(req({ name: 'Acme' }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/meta/clients — with token (legacy verify+connect preserved)', () => {
  it('verifies via Meta, encrypts the token, and inserts status "connected"', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch' as any).mockImplementation(async (url: any) => {
      const u = String(url);
      if (u.includes('/me?')) return { json: async () => ({ id: 'fb-1', name: 'FB User' }) } as any;
      if (u.includes('/me/accounts')) return { json: async () => ({ data: [{ id: 'page-1', name: 'Page One' }] }) } as any;
      if (u.includes('/me/adaccounts')) return { json: async () => ({ data: [{ id: 'act_1', name: 'Ads One', currency: 'ILS' }] }) } as any;
      throw new Error(`unexpected fetch ${u}`);
    });

    const res = await POST(req({ name: 'Acme', token: 'EAAtoken123' }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3); // /me, /me/accounts, /me/adaccounts

    expect(H.insertPayload).toMatchObject({
      name: 'Acme',
      token_encrypted: 'enc(EAAtoken123)',
      meta_user_id: 'fb-1',
      meta_user_name: 'FB User',
      selected_page_id: 'page-1',
      selected_ad_account_id: 'act_1',
      status: 'connected',
    });
    expect(H.insertPayload.pages).toHaveLength(1);
    expect(H.insertPayload.ad_accounts).toHaveLength(1);
    expect(data.id).toBe('new-client-id');
  });

  it('400s with the Meta error message when the token is invalid', async () => {
    vi.spyOn(global, 'fetch' as any).mockImplementation(async () =>
      ({ json: async () => ({ error: { message: 'Invalid OAuth token' } }) }) as any);

    const res = await POST(req({ name: 'Acme', token: 'bad' }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toBe('Invalid OAuth token');
  });
});
