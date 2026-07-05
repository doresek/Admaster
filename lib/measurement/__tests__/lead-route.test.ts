// The extended public lead route (app/api/landing/lead) — measurement wiring.
// Proves back-compat (the legacy landing_page_leads insert shape is untouched),
// the funnel_leads + lead_touchpoints creation, consent capture, the first-touch
// cookie fallback, and the LEAD-CAPTURE-IS-SACRED guarantee: every funnel
// failure still returns success to the visitor, with the reason RECORDED in
// the response meta.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { serializeFirstTouch, parseClickIds } from '../capture';
import { mockSupabase, type SupabaseMock } from './mock-supabase';

const H = vi.hoisted(() => ({
  cfg: {
    page: {
      id: 'lp1', user_id: 'owner-1', status: 'published', title: 'דף', slug: 's',
      client_id: 'client-A',
    } as Record<string, unknown> | null,
    /** When set, createAdminClient throws (simulates missing service key). */
    adminThrows: false,
  },
  captured: {
    leadInsert: undefined as Record<string, unknown> | undefined,
    rpcCalls:   [] as string[],
  },
  // Assigned per-test in beforeEach (vi.hoisted runs before imports).
  admin: null as unknown as SupabaseMock,
}));

vi.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    from(table: string) {
      if (table === 'landing_pages') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: H.cfg.page }) }) }) };
      }
      if (table === 'landing_page_leads') {
        return { insert: async (p: Record<string, unknown>) => { H.captured.leadInsert = p; return { error: null }; } };
      }
      if (table === 'agency_settings') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      }
      throw new Error(`anon client should not touch ${table}`);
    },
    rpc: (name: string) => { H.captured.rpcCalls.push(name); return Promise.resolve({}); },
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => { throw new Error('not used by this route'); },
  createAdminClient: () => {
    if (H.cfg.adminThrows) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
    return H.admin.client;
  },
}));

interface FakeReqInit {
  body:     unknown;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}

// Stand-in for NextRequest: the handler touches .json(), .headers.get(), .cookies.get().
// Nominal-type stub cast at the test boundary (same convention as tests/landing-leads.test.ts).
function fakeReq(init: FakeReqInit): Parameters<typeof import('@/app/api/landing/lead/route')['POST']>[0] {
  const shape = {
    json: async () => init.body,
    headers: { get: (k: string) => init.headers?.[k.toLowerCase()] ?? null },
    cookies: { get: (name: string) => (init.cookies && name in init.cookies ? { name, value: init.cookies[name] } : undefined) },
  };
  return shape as unknown as Parameters<typeof import('@/app/api/landing/lead/route')['POST']>[0];
}

const goodBody = (over: Record<string, unknown> = {}) => ({
  slug: 's',
  fields: { name: 'דנה', phone: '050-123-4567' },
  touchpoint: { fbclid: 'fb1', utm: { source: 'facebook', medium: 'cpc' }, landing_path: '/lp/s' },
  consentMarketing: false,
  ...over,
});

beforeEach(() => {
  H.cfg.page = { id: 'lp1', user_id: 'owner-1', status: 'published', title: 'דף', slug: 's', client_id: 'client-A' };
  H.cfg.adminThrows = false;
  H.captured.leadInsert = undefined;
  H.captured.rpcCalls = [];
  H.admin = mockSupabase();
});

describe('back-compat — the legacy path is byte-identical', () => {
  it('landing_page_leads insert shape unchanged; RPCs still fire; 200 ok', async () => {
    const { POST } = await import('@/app/api/landing/lead/route');
    const res = await POST(fakeReq({
      body: goodBody(), headers: { 'user-agent': 'UA/1.0', referer: 'https://ref.example/page' },
    }));
    expect(res.status).toBe(200);
    expect(H.captured.leadInsert).toEqual({
      landing_page_id: 'lp1',
      user_id:         'owner-1',
      fields:          { name: 'דנה', phone: '050-123-4567' },
      user_agent:      'UA/1.0',
      referrer:        'https://ref.example/page',
    });
    expect(H.captured.rpcCalls).toContain('increment_lp_conversion');
    expect(H.captured.rpcCalls).toContain('notify_landing_lead');
  });

  it('a legacy body (no touchpoint/consent) still works — funnel lead with empty identity', async () => {
    const { POST } = await import('@/app/api/landing/lead/route');
    const res = await POST(fakeReq({ body: { slug: 's', fields: { name: 'x' } } }));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.meta.funnelLead.status).toBe('created');
    const lead = H.admin.rows('funnel_leads')[0];
    expect(lead.consent_marketing).toBe(false);
    expect(lead.consent_recorded_at).toBeNull();
  });

  it('missing slug/fields → 400, nothing written anywhere', async () => {
    const { POST } = await import('@/app/api/landing/lead/route');
    const res = await POST(fakeReq({ body: { slug: 's' } }));
    expect(res.status).toBe(400);
    expect(H.captured.leadInsert).toBeUndefined();
    expect(H.admin.rows('funnel_leads')).toHaveLength(0);
  });
});

describe('funnel registration (measurement spine)', () => {
  it('creates funnel_leads + lead_touchpoints from the validated payload', async () => {
    const { POST } = await import('@/app/api/landing/lead/route');
    const res = await POST(fakeReq({ body: goodBody(), headers: { 'user-agent': 'UA/1.0' } }));
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, meta: { funnelLead: { status: 'created' } } });

    const lead = H.admin.rows('funnel_leads')[0];
    expect(lead).toMatchObject({
      client_id: 'client-A', owner_user_id: 'owner-1', source: 'landing',
      phone: '0501234567', current_stage: 'new',
      source_ref: { landing_page_id: 'lp1', slug: 's' },
    });
    const tp = H.admin.rows('lead_touchpoints')[0];
    expect(tp).toMatchObject({
      lead_id: lead.id, fbclid: 'fb1',
      utm: { source: 'facebook', medium: 'cpc' }, landing_path: '/lp/s',
      user_agent: 'UA/1.0',
    });
  });

  it('consentMarketing:true → recorded with timestamp; anything non-true → false', async () => {
    const { POST } = await import('@/app/api/landing/lead/route');
    await POST(fakeReq({ body: goodBody({ consentMarketing: true }) }));
    expect(H.admin.rows('funnel_leads')[0].consent_marketing).toBe(true);
    expect(typeof H.admin.rows('funnel_leads')[0].consent_recorded_at).toBe('string');

    H.admin = mockSupabase();
    await POST(fakeReq({ body: goodBody({ consentMarketing: 'yes' }) })); // string, not literal true
    expect(H.admin.rows('funnel_leads')[0].consent_marketing).toBe(false);
  });

  it('injection-shaped touchpoint values are rejected before the DB', async () => {
    const { POST } = await import('@/app/api/landing/lead/route');
    await POST(fakeReq({
      body: goodBody({
        touchpoint: { fbclid: '<script>x</script>', gclid: 'ok123', utm: { source: 'facebook', medium: '"; drop' } },
      }),
    }));
    const tp = H.admin.rows('lead_touchpoints')[0];
    expect(tp.fbclid).toBeNull();
    expect(tp.gclid).toBe('ok123');
    expect(tp.utm).toEqual({ source: 'facebook' });
  });

  it('falls back to the first-touch am_tp cookie when the payload has no ids', async () => {
    const cookieIdentity = parseClickIds({ gclid: 'gclid-first', utm: { source: 'google' }, landing_path: '/lp/s' });
    const { POST } = await import('@/app/api/landing/lead/route');
    await POST(fakeReq({
      body: goodBody({ touchpoint: undefined }),
      cookies: { am_tp: serializeFirstTouch(cookieIdentity) },
    }));
    const tp = H.admin.rows('lead_touchpoints')[0];
    expect(tp.gclid).toBe('gclid-first');
    expect(tp.utm).toEqual({ source: 'google' });
  });

  it('payload identity WINS over the cookie (last-click)', async () => {
    const cookieIdentity = parseClickIds({ fbclid: 'old-fb', utm: { source: 'facebook' } });
    const { POST } = await import('@/app/api/landing/lead/route');
    await POST(fakeReq({
      body: goodBody({ touchpoint: { gclid: 'new-g', utm: { source: 'google' } } }),
      cookies: { am_tp: serializeFirstTouch(cookieIdentity) },
    }));
    const tp = H.admin.rows('lead_touchpoints')[0];
    expect(tp.gclid).toBe('new-g');
    expect(tp.fbclid).toBe('old-fb'); // gap filled from first touch
    expect(tp.utm).toEqual({ source: 'google' }); // utm block atomic
  });

  it('page without a client → typed skip (funnel_leads.client_id is NOT NULL)', async () => {
    H.cfg.page = { ...(H.cfg.page ?? {}), client_id: null };
    const { POST } = await import('@/app/api/landing/lead/route');
    const res = await POST(fakeReq({ body: goodBody() }));
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.meta.funnelLead).toEqual({ status: 'skipped', reason: 'page_has_no_client' });
    expect(H.admin.rows('funnel_leads')).toHaveLength(0);
  });
});

describe('LEAD CAPTURE IS SACRED', () => {
  it('funnel insert failure → visitor still gets 200 ok; reason recorded in meta', async () => {
    H.admin.failOn.add('insert:funnel_leads');
    const { POST } = await import('@/app/api/landing/lead/route');
    const res = await POST(fakeReq({ body: goodBody() }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.meta.funnelLead).toEqual({ status: 'failed', reason: 'lead_insert_failed' });
    // the legacy lead row was still written — nothing lost
    expect(H.captured.leadInsert).toBeDefined();
    expect(H.captured.rpcCalls).toContain('notify_landing_lead');
  });

  it('admin client unavailable (thrown) → 200 ok with measurement_error meta', async () => {
    H.cfg.adminThrows = true;
    const { POST } = await import('@/app/api/landing/lead/route');
    const res = await POST(fakeReq({ body: goodBody() }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.meta.funnelLead).toEqual({ status: 'failed', reason: 'measurement_error' });
    expect(H.captured.leadInsert).toBeDefined();
  });

  it('re-inquiry (dedupe hit) reports "reattached" and keeps ONE funnel lead', async () => {
    const { POST } = await import('@/app/api/landing/lead/route');
    await POST(fakeReq({ body: goodBody() }));
    const res = await POST(fakeReq({ body: goodBody() }));
    const json = await res.json();
    expect(json.meta.funnelLead.status).toBe('reattached');
    expect(H.admin.rows('funnel_leads')).toHaveLength(1);
    expect(H.admin.rows('lead_touchpoints')).toHaveLength(2);
  });
});
