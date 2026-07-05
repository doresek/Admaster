// /api/measurement — auth, validation, ownership scoping, and the typed
// stage-mark outcomes surfacing as the right HTTP statuses (409 for illegal
// transitions, 404 for unknown leads).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabase, type MockRow, type SupabaseMock } from './mock-supabase';

const H = vi.hoisted(() => ({
  cfg: {
    authUser:     { id: 'owner-1' } as { id: string } | null,
    ownedClients: new Set<string>(),
  },
  admin: null as unknown as SupabaseMock,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.cfg.authUser } }) },
    from: (table: string) => {
      if (table !== 'clients') throw new Error(`user client should not touch ${table}`);
      let requestedId = '';
      const builder = {
        select: () => builder,
        eq: (_col: string, val: string) => { requestedId = val; return builder; },
        maybeSingle: async () => ({
          data: H.cfg.ownedClients.has(requestedId) ? { id: requestedId } : null,
        }),
      };
      return builder;
    },
  }),
  createAdminClient: () => H.admin.client,
}));

const CLIENT = '11111111-1111-4111-8111-111111111111';
const LEAD   = '22222222-2222-4222-8222-222222222222';

const leadRow = (over: MockRow = {}): MockRow => ({
  id: LEAD, client_id: CLIENT, owner_user_id: 'owner-1',
  source: 'landing', source_ref: {}, name: 'דנה', phone: '0501234567', email: null,
  consent_marketing: false, consent_recorded_at: null,
  current_stage: 'new', value: null,
  created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
  ...over,
});

// Nominal test-stub cast for NextRequest (route touches nextUrl.searchParams / json()).
type GetReq  = Parameters<typeof import('@/app/api/measurement/route')['GET']>[0];
type PostReq = Parameters<typeof import('@/app/api/measurement/route')['POST']>[0];

function getReq(query: Record<string, string>): GetReq {
  const shape = { nextUrl: { searchParams: new URLSearchParams(query) } };
  return shape as unknown as GetReq;
}
function postReq(body: unknown): PostReq {
  const shape = { json: async () => body };
  return shape as unknown as PostReq;
}

beforeEach(() => {
  H.cfg.authUser = { id: 'owner-1' };
  H.cfg.ownedClients = new Set([CLIENT]);
  H.admin = mockSupabase();
});

describe('GET /api/measurement', () => {
  it('401 when unauthenticated', async () => {
    H.cfg.authUser = null;
    const { GET } = await import('@/app/api/measurement/route');
    expect((await GET(getReq({ clientId: CLIENT }))).status).toBe(401);
  });

  it('400 on a non-UUID clientId / bad stage / bad limit', async () => {
    const { GET } = await import('@/app/api/measurement/route');
    expect((await GET(getReq({ clientId: 'nope' }))).status).toBe(400);
    expect((await GET(getReq({ clientId: CLIENT, stage: 'won' }))).status).toBe(400);
    expect((await GET(getReq({ clientId: CLIENT, limit: '0' }))).status).toBe(400);
    expect((await GET(getReq({ clientId: CLIENT, limit: '9999' }))).status).toBe(400);
  });

  it('404 for a client the caller does not own (RLS-scoped check)', async () => {
    H.cfg.ownedClients = new Set();
    const { GET } = await import('@/app/api/measurement/route');
    expect((await GET(getReq({ clientId: CLIENT }))).status).toBe(404);
  });

  it('returns the client-scoped lead list (stage-filtered)', async () => {
    H.admin.seed('funnel_leads', [
      leadRow({ id: 'a', current_stage: 'new', created_at: '2026-07-01T00:00:00.000Z' }),
      leadRow({ id: 'b', current_stage: 'qualified', created_at: '2026-07-02T00:00:00.000Z' }),
    ]);
    const { GET } = await import('@/app/api/measurement/route');
    const res = await GET(getReq({ clientId: CLIENT, stage: 'qualified' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.leads.map((l: { id: string }) => l.id)).toEqual(['b']);
  });
});

describe('POST /api/measurement', () => {
  const goodBody = (over: Record<string, unknown> = {}) => ({
    clientId: CLIENT, leadId: LEAD, stage: 'qualified', ...over,
  });

  it('401 / 400s: auth, JSON shape, UUIDs, stage, value, note', async () => {
    const { POST } = await import('@/app/api/measurement/route');

    H.cfg.authUser = null;
    expect((await POST(postReq(goodBody()))).status).toBe(401);
    H.cfg.authUser = { id: 'owner-1' };

    expect((await POST(postReq('not an object'))).status).toBe(400);
    expect((await POST(postReq(goodBody({ clientId: 'x' })))).status).toBe(400);
    expect((await POST(postReq(goodBody({ leadId: 'x' })))).status).toBe(400);
    expect((await POST(postReq(goodBody({ stage: 'won' })))).status).toBe(400);
    expect((await POST(postReq(goodBody({ value: -5 })))).status).toBe(400);
    expect((await POST(postReq(goodBody({ value: 'much' })))).status).toBe(400);
    expect((await POST(postReq(goodBody({ note: 'x'.repeat(501) })))).status).toBe(400);
    expect(H.admin.rows('lead_stage_events')).toHaveLength(0);
  });

  it('404 for an unowned client', async () => {
    H.cfg.ownedClients = new Set();
    const { POST } = await import('@/app/api/measurement/route');
    expect((await POST(postReq(goodBody()))).status).toBe(404);
  });

  it('marks the stage via markedVia "ui" and returns lead+event+learning', async () => {
    H.admin.seed('funnel_leads', [leadRow()]);
    const { POST } = await import('@/app/api/measurement/route');
    const res = await POST(postReq(goodBody({ note: 'שיחה טובה' })));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.lead.current_stage).toBe('qualified');
    expect(json.event).toMatchObject({ stage: 'qualified', marked_via: 'ui', note: 'שיחה טובה' });
    expect(json.learning).toMatchObject({ emitted: false, skipped: 'not_an_outcome_stage' });
  });

  it('409 on an illegal transition (typed, nothing written)', async () => {
    H.admin.seed('funnel_leads', [leadRow({ current_stage: 'closed_won' })]);
    const { POST } = await import('@/app/api/measurement/route');
    const res = await POST(postReq(goodBody({ stage: 'new' })));
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('invalid_transition');
    expect(H.admin.rows('lead_stage_events')).toHaveLength(0);
  });

  it('404 when the lead does not exist under this client', async () => {
    const { POST } = await import('@/app/api/measurement/route');
    const res = await POST(postReq(goodBody()));
    expect(res.status).toBe(404);
    expect((await res.json()).reason).toBe('lead_not_found');
  });
});
