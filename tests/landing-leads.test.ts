// Characterization tests for the LANDING PAGES + LEADS feature.
//
// These lock in what the code does TODAY (warts included), not what we may
// want later. They are a safety net for upcoming work on client attribution
// ("leads per client" on the client card).
//
// Strategy: where a path is cleanly invokable we drive the REAL route handler
// with a mocked Supabase client and assert the exact insert payload. Where a
// path is too coupled (AI calls, multi-query rule engines) we DO NOT test it —
// see the COUPLING FINDINGS block at the bottom of this file.
//
// Verified-against-source facts this file locks:
//   • landing_pages.client_id  — FK → meta_clients, ON DELETE SET NULL, NULLABLE
//     (supabase/migrations/004_phase_b.sql:14)
//   • landing_page_leads        — has NO client_id column at all; it links only
//     to landing_page_id (FK, NOT NULL) and user_id (FK, NOT NULL)
//     (supabase/migrations/004_phase_b.sql:40-48)
//   • POST /api/landing         — only place a landing_pages row is INSERTed
//     (app/api/landing/route.ts:70). /generate, /variants return content only;
//     /refine UPDATEs content; /upload writes storage only.
//   • POST /api/landing/lead    — the only place a landing_page_leads row is
//     INSERTed (app/api/landing/lead/route.ts:27).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Shared, hoisted, mutable test state ─────────────────────────────
// vi.mock factories are hoisted above imports, so the fake clients read their
// config from this hoisted object. Each test resets it in beforeEach.
const H = vi.hoisted(() => ({
  cfg: {
    // landing route (auth + slug uniqueness + list)
    authUser:    { id: 'owner-1' } as { id: string } | null,
    slugLookups: [] as Array<{ data: any }>, // successive .maybeSingle() results for the slug loop
    listRows:    [] as any[],                 // GET list result
    // lead route (public submission)
    page:           { id: 'lp1', user_id: 'owner-1', status: 'published', title: 'דף בדיקה', slug: 's' } as any,
    agencySettings: null as any,
  },
  captured: {
    pageInsert: undefined as any,
    leadInsert: undefined as any,
    rpcCalls:   [] as Array<{ name: string; args: any }>,
  },
}));

// ── Mock for the authenticated landing route (@/lib/supabase/server) ──
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: H.cfg.authUser } }) },
    from(_table: string) {
      let insertPayload: any;
      const builder: any = {
        select: () => builder,
        eq:     () => builder,
        // GET list terminates on .order(...) → resolves {data}
        order:  async () => ({ data: H.cfg.listRows }),
        // slug-uniqueness loop terminates on .maybeSingle()
        maybeSingle: async () =>
          H.cfg.slugLookups.length ? H.cfg.slugLookups.shift()! : { data: null },
        insert: (p: any) => { H.captured.pageInsert = p; insertPayload = p; return builder; },
        // POST insert terminates on .single() → echo the inserted row back
        single: async () => ({ data: { id: 'new-id', ...insertPayload }, error: null }),
      };
      return builder;
    },
  }),
}));

// ── Mocks for the PUBLIC lead route (@supabase/ssr + next/headers) ────
vi.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    from(table: string) {
      if (table === 'landing_pages') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: H.cfg.page }) }) }) };
      }
      if (table === 'landing_page_leads') {
        return { insert: async (p: any) => { H.captured.leadInsert = p; return { error: null }; } };
      }
      if (table === 'agency_settings') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: H.cfg.agencySettings }) }) }) };
      }
      return {} as any;
    },
    rpc: (name: string, args: any) => {
      H.captured.rpcCalls.push({ name, args });
      return Promise.resolve({});
    },
  }),
}));

// A minimal NextRequest stand-in: the handlers only touch .json(), .headers.get(), .url
function fakeReq(body: any, headers: Record<string, string> = {}, url = 'http://localhost/api/landing'): any {
  return {
    url,
    json: async () => body,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  };
}

beforeEach(() => {
  H.cfg.authUser    = { id: 'owner-1' };
  H.cfg.slugLookups = [];
  H.cfg.listRows    = [];
  H.cfg.page        = { id: 'lp1', user_id: 'owner-1', status: 'published', title: 'דף בדיקה', slug: 's' };
  H.cfg.agencySettings = null;
  H.captured.pageInsert = undefined;
  H.captured.leadInsert = undefined;
  H.captured.rpcCalls   = [];
});

// ════════════════════════════════════════════════════════════════════
// 1. landing_page_leads INSERT shape — the attribution crux
//    (real handler: app/api/landing/lead/route.ts)
// ════════════════════════════════════════════════════════════════════
describe('POST /api/landing/lead — lead insert shape (real handler)', () => {
  it('inserts EXACTLY {landing_page_id, user_id, fields, user_agent, referrer} — and NO client_id', async () => {
    const { POST } = await import('@/app/api/landing/lead/route');
    const res = await POST(fakeReq(
      { slug: 's', fields: { name: 'דנה', phone: '0501234567' } },
      { 'user-agent': 'UA/1.0', referer: 'https://ref.example' },
    ));

    expect(res.status).toBe(200);
    expect(H.captured.leadInsert).toEqual({
      landing_page_id: 'lp1',
      user_id:         'owner-1',
      fields:          { name: 'דנה', phone: '0501234567' },
      user_agent:      'UA/1.0',
      referrer:        'https://ref.example',
    });
    // The attribution gap, locked: a lead carries no direct client reference.
    expect('client_id' in H.captured.leadInsert).toBe(false);
  });

  it('attributes the lead to the PAGE OWNER (page.user_id), not the anonymous submitter', async () => {
    H.cfg.page = { ...H.cfg.page, user_id: 'agency-owner-42' };
    const { POST } = await import('@/app/api/landing/lead/route');
    await POST(fakeReq({ slug: 's', fields: { email: 'a@b.com' } }));
    expect(H.captured.leadInsert.user_id).toBe('agency-owner-42');
  });

  it('null user_agent / referrer when those headers are absent', async () => {
    const { POST } = await import('@/app/api/landing/lead/route');
    await POST(fakeReq({ slug: 's', fields: { name: 'x' } })); // no headers
    expect(H.captured.leadInsert.user_agent).toBeNull();
    expect(H.captured.leadInsert.referrer).toBeNull();
  });

  it('non-published page → 404 and NO lead is inserted', async () => {
    H.cfg.page = { ...H.cfg.page, status: 'draft' };
    const { POST } = await import('@/app/api/landing/lead/route');
    const res = await POST(fakeReq({ slug: 's', fields: { name: 'x' } }));
    expect(res.status).toBe(404);
    expect(H.captured.leadInsert).toBeUndefined();
  });

  it('missing slug or fields → 400 and NO lead is inserted', async () => {
    const { POST } = await import('@/app/api/landing/lead/route');
    const res = await POST(fakeReq({ slug: 's' })); // no fields
    expect(res.status).toBe(400);
    expect(H.captured.leadInsert).toBeUndefined();
  });

  it('on success also fires the increment_lp_conversion + notify_landing_lead RPCs', async () => {
    const { POST } = await import('@/app/api/landing/lead/route');
    await POST(fakeReq({ slug: 's', fields: { name: 'x' } }));
    const names = H.captured.rpcCalls.map(r => r.name);
    expect(names).toContain('increment_lp_conversion');
    expect(names).toContain('notify_landing_lead');
    // The notification href points at the owner's editor for this page.
    const notify = H.captured.rpcCalls.find(r => r.name === 'notify_landing_lead');
    expect(notify!.args.p_href).toBe('/landing-pages/edit/lp1');
  });

  // ── Attribution capture (W5.1a) ──────────────────────────────────────
  // landing_page_leads has NO client_id column (schema gap, see file header),
  // so the lead ROW cannot carry it without a separate migration. We still
  // RESOLVE the owning client from landing_pages.client_id and surface it on
  // the notify_landing_lead meta so the client is captured at submit time.
  it('resolves the owning client_id from the page and includes it in the notify meta', async () => {
    H.cfg.page = { ...H.cfg.page, client_id: 'client-A' };
    const { POST } = await import('@/app/api/landing/lead/route');
    await POST(fakeReq({ slug: 's', fields: { name: 'דנה' } }));
    const notify = H.captured.rpcCalls.find(r => r.name === 'notify_landing_lead');
    expect(notify!.args.p_meta.client_id).toBe('client-A');
    // The lead row itself still has no client_id (no column) — the gap is documented.
    expect('client_id' in H.captured.leadInsert).toBe(false);
  });

  it('notify meta client_id is null when the page has no client', async () => {
    H.cfg.page = { ...H.cfg.page, client_id: null };
    const { POST } = await import('@/app/api/landing/lead/route');
    await POST(fakeReq({ slug: 's', fields: { name: 'x' } }));
    const notify = H.captured.rpcCalls.find(r => r.name === 'notify_landing_lead');
    expect(notify!.args.p_meta.client_id).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. landing_pages INSERT shape — does a new page link to a client?
//    (real handler: app/api/landing/route.ts POST)
// ════════════════════════════════════════════════════════════════════
describe('POST /api/landing — page insert shape (real handler)', () => {
  // A valid active-client cookie value (readActiveClientCookie requires a 36-char id).
  const ACTIVE = '11111111-1111-1111-1111-111111111111';

  it('client_id is persisted from the ACTIVE client when the body omits it (dashboard create flow)', async () => {
    // The dashboard UI posts only { template, title, content } — never client_id.
    // The route now falls back to the active-client cookie, so product-created
    // pages are born linked to the active client (mirrors the posts writers).
    const { POST } = await import('@/app/api/landing/route');
    const res = await POST(fakeReq(
      { template: 'squeeze', title: 'השקת קורס', content: { hero_title: 'x' } },
      { cookie: `admaster_active_client=${ACTIVE}` },
    ));
    expect(res.status).toBe(200);
    expect(H.captured.pageInsert.client_id).toBe(ACTIVE);
    expect(H.captured.pageInsert.user_id).toBe('owner-1');
    expect(H.captured.pageInsert.status).toBe('draft');
    expect(H.captured.pageInsert.template).toBe('squeeze');
  });

  it('client_id is NULL only when neither the body nor an active client is present', async () => {
    const { POST } = await import('@/app/api/landing/route');
    await POST(fakeReq({ template: 'squeeze', title: 'T', content: {} })); // no body client_id, no cookie
    expect(H.captured.pageInsert.client_id).toBeNull();
  });

  it('explicit body client_id wins over the active-client cookie', async () => {
    const { POST } = await import('@/app/api/landing/route');
    await POST(fakeReq(
      { template: 'squeeze', title: 'T', client_id: 'client-7', content: {} },
      { cookie: `admaster_active_client=${ACTIVE}` },
    ));
    expect(H.captured.pageInsert.client_id).toBe('client-7');
  });

  it('slug collision appends a numeric suffix (-2)', async () => {
    // First uniqueness probe finds a row, second is clean → "t-2".
    H.cfg.slugLookups = [{ data: { id: 'taken' } }, { data: null }];
    const { POST } = await import('@/app/api/landing/route');
    await POST(fakeReq({ template: 'squeeze', title: 'T', content: {} }));
    expect(H.captured.pageInsert.slug).toBe('t-2');
  });

  it('missing template or title → 400, no insert', async () => {
    const { POST } = await import('@/app/api/landing/route');
    const res = await POST(fakeReq({ template: 'squeeze' })); // no title
    expect(res.status).toBe(400);
    expect(H.captured.pageInsert).toBeUndefined();
  });

  it('unauthenticated → 401, no insert', async () => {
    H.cfg.authUser = null;
    const { POST } = await import('@/app/api/landing/route');
    const res = await POST(fakeReq({ template: 'squeeze', title: 'T', content: {} }));
    expect(res.status).toBe(401);
    expect(H.captured.pageInsert).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. GET /api/landing — list scoping (real handler)
// ════════════════════════════════════════════════════════════════════
describe('GET /api/landing — list is scoped to the owner', () => {
  it('returns the rows the (user_id-scoped) query yields', async () => {
    H.cfg.listRows = [{ id: 'a' }, { id: 'b' }];
    const { GET } = await import('@/app/api/landing/route');
    const res = await GET();
    expect(await res.json()).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. ATTRIBUTION MODEL — "leads per client" reality, locked as pure logic.
//    There is NO production function that counts leads per client today.
//    The ONLY chain available is:
//        lead.landing_page_id → landing_pages.id → landing_pages.client_id
//    a TWO-HOP join whose middle column (client_id) is nullable. As of this
//    slice, product-created pages carry the active client_id, so leads now
//    attribute through the page; only pages predating the change (or created
//    with no active client) land in the unattributed bucket.
// ════════════════════════════════════════════════════════════════════
type Lead = { id: string; landing_page_id: string };
type Page = { id: string; client_id: string | null };

// Mirror of the only join the schema permits (no shortcut column exists).
function leadsPerClient(leads: Lead[], pages: Page[]): Record<string, number> {
  const pageToClient = new Map(pages.map(p => [p.id, p.client_id]));
  const counts: Record<string, number> = {};
  for (const lead of leads) {
    const clientId = pageToClient.get(lead.landing_page_id) ?? null;
    const bucket = clientId ?? '__unattributed__';
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

describe('attribution model: leads → landing_page → client (two-hop, nullable middle)', () => {
  it('LEGACY: pages with client_id=null (pre-slice / no active client) → leads unattributed', () => {
    const pages: Page[] = [{ id: 'lp1', client_id: null }, { id: 'lp2', client_id: null }];
    const leads: Lead[] = [
      { id: 'L1', landing_page_id: 'lp1' },
      { id: 'L2', landing_page_id: 'lp1' },
      { id: 'L3', landing_page_id: 'lp2' },
    ];
    expect(leadsPerClient(leads, pages)).toEqual({ __unattributed__: 3 });
  });

  it('NOW: product pages carry client_id, so leads attribute to that client', () => {
    const pages: Page[] = [{ id: 'lp1', client_id: 'client-A' }, { id: 'lp2', client_id: 'client-B' }];
    const leads: Lead[] = [
      { id: 'L1', landing_page_id: 'lp1' },
      { id: 'L2', landing_page_id: 'lp1' },
      { id: 'L3', landing_page_id: 'lp2' },
    ];
    expect(leadsPerClient(leads, pages)).toEqual({ 'client-A': 2, 'client-B': 1 });
  });

  it('a lead pointing at a page with null client_id still falls into the unattributed bucket', () => {
    const pages: Page[] = [{ id: 'lp1', client_id: 'client-A' }, { id: 'lp2', client_id: null }];
    const leads: Lead[] = [
      { id: 'L1', landing_page_id: 'lp1' },
      { id: 'L2', landing_page_id: 'lp2' },
    ];
    expect(leadsPerClient(leads, pages)).toEqual({ 'client-A': 1, __unattributed__: 1 });
  });
});

// ════════════════════════════════════════════════════════════════════
// COUPLING FINDINGS — paths intentionally NOT unit-tested here
// ════════════════════════════════════════════════════════════════════
// (a) /api/landing/generate, /refine, /variants — each calls the Anthropic SDK
//     (live network) and is gated behind credit deduct/refund. The DB effects
//     are: generate=NONE (returns content only), variants=NONE, refine=UPDATE
//     content (no client_id touched). The AI-context assembly they share
//     (buildAiContext) is already covered by tests/brief-flow.test.ts.
// (b) /api/landing/upload — Supabase Storage only; no DB row, no client link.
// (c) GET /api/recommendations — the ONLY read path that consumes
//     landing_page_leads (route.ts:29) selects 'id, created_at' scoped by
//     user_id ONLY; leads are counted globally, never per client. The route
//     fans out 9 parallel queries through a large rule engine — too coupled for
//     a focused unit test; its lead usage is documented here instead.
// (d) slugify() in app/api/landing/route.ts is NOT exported; its behavior is
//     exercised indirectly via the slug-collision test above.
