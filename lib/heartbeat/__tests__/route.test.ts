// API route tests: the CRON_SECRET guard (fail closed), the trigger paths
// (POST body / cron GET with ?tick=), and the owner-scoped status GET.
// MOCKED supabase server module + mocked runHeartbeat — no DB, no network.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { mockSupabase, type SupabaseMock } from './mock-supabase';

const H = vi.hoisted(() => {
  const state: {
    authUser:     { id: string } | null;
    db:           SupabaseMock | null;
    runHeartbeat: ReturnType<typeof vi.fn>;
  } = { authUser: null, db: null, runHeartbeat: vi.fn() };
  return state;
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: H.authUser } }) },
    from: (table: string) => H.db!.client.from(table),
  }),
  createAdminClient: () => H.db!.client,
}));

vi.mock('@/lib/heartbeat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/heartbeat')>();
  return { ...actual, runHeartbeat: H.runHeartbeat };
});

import { GET, POST } from '@/app/api/heartbeat/route';

const SECRET = 'test-cron-secret';
const URL_BASE = 'http://localhost/api/heartbeat';

function postReq(opts: { auth?: string; body?: unknown; query?: string } = {}): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (opts.auth !== undefined) headers.set('authorization', opts.auth);
  return new NextRequest(`${URL_BASE}${opts.query ?? ''}`, {
    method: 'POST',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function getReq(query: string, auth?: string): NextRequest {
  const headers = new Headers();
  if (auth !== undefined) headers.set('authorization', auth);
  return new NextRequest(`${URL_BASE}${query}`, { method: 'GET', headers });
}

const savedSecret = process.env.CRON_SECRET;

beforeEach(() => {
  H.db = mockSupabase();
  H.authUser = null;
  H.runHeartbeat.mockReset();
  H.runHeartbeat.mockResolvedValue({ tick: 'daily', ranAt: 'x', results: [], notes: [] });
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

describe('POST /api/heartbeat — the cron guard', () => {
  it('401 without an Authorization header; the heartbeat never runs', async () => {
    const res = await POST(postReq({ body: { tick: 'daily' } }));
    expect(res.status).toBe(401);
    expect(H.runHeartbeat).not.toHaveBeenCalled();
  });

  it('401 with the wrong secret', async () => {
    const res = await POST(postReq({ auth: 'Bearer wrong-secret', body: { tick: 'daily' } }));
    expect(res.status).toBe(401);
    expect(H.runHeartbeat).not.toHaveBeenCalled();
  });

  it('401 when CRON_SECRET is unset — an unconfigured guard fails CLOSED', async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(postReq({ auth: 'Bearer undefined', body: { tick: 'daily' } }));
    expect(res.status).toBe(401);
    expect(H.runHeartbeat).not.toHaveBeenCalled();
  });

  it('happy path: authorized POST triggers runHeartbeat with the tick and returns the summary', async () => {
    const res = await POST(postReq({ auth: `Bearer ${SECRET}`, body: { tick: 'weekly' } }));
    expect(res.status).toBe(200);
    expect(H.runHeartbeat).toHaveBeenCalledTimes(1);
    const [, opts] = H.runHeartbeat.mock.calls[0];
    expect(opts).toMatchObject({ tick: 'weekly' });
    const payload: unknown = await res.json();
    expect(payload).toMatchObject({ tick: 'daily', results: [] }); // the stubbed summary, echoed
  });

  it('400 on an unknown tick', async () => {
    const res = await POST(postReq({ auth: `Bearer ${SECRET}`, body: { tick: 'hourly' } }));
    expect(res.status).toBe(400);
    expect(H.runHeartbeat).not.toHaveBeenCalled();
  });

  it('accepts ?tick= when the body is empty (cron-style trigger)', async () => {
    const res = await POST(postReq({ auth: `Bearer ${SECRET}`, query: '?tick=monthly' }));
    expect(res.status).toBe(200);
    const [, opts] = H.runHeartbeat.mock.calls[0];
    expect(opts).toMatchObject({ tick: 'monthly' });
  });
});

describe('GET /api/heartbeat?tick= — Vercel Cron compatibility', () => {
  it('a cron-authorized GET with ?tick= triggers the run', async () => {
    const res = await GET(getReq('?tick=daily', `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(H.runHeartbeat).toHaveBeenCalledTimes(1);
  });

  it('an unauthorized GET with ?tick= is 401 (no cookie fallback for triggers)', async () => {
    H.authUser = { id: 'owner-1' }; // even a logged-in user cannot spin the fleet
    const res = await GET(getReq('?tick=daily'));
    expect(res.status).toBe(401);
    expect(H.runHeartbeat).not.toHaveBeenCalled();
  });
});

describe('GET /api/heartbeat?clientId= — the status surface', () => {
  it('401 unauthenticated', async () => {
    const res = await GET(getReq('?clientId=11111111-1111-1111-1111-111111111111'));
    expect(res.status).toBe(401);
  });

  it('400 on a missing/malformed clientId', async () => {
    H.authUser = { id: 'owner-1' };
    expect((await GET(getReq(''))).status).toBe(400);
    expect((await GET(getReq('?clientId=not-a-uuid'))).status).toBe(400);
  });

  it('returns the owner-scoped recent runs, newest first', async () => {
    H.authUser = { id: 'owner-1' };
    const clientId = '11111111-1111-1111-1111-111111111111';
    H.db!.seed('heartbeat_runs', [
      { id: 'r1', client_id: clientId, owner_user_id: 'owner-1', tick_type: 'daily',
        status: 'succeeded', attention: {}, actions: [], notes: [], tokens_used: null,
        error: null, lease_until: null, started_at: null, finished_at: null,
        created_at: '2026-07-01T06:00:00.000Z' },
      { id: 'r2', client_id: clientId, owner_user_id: 'owner-1', tick_type: 'daily',
        status: 'failed', attention: {}, actions: [], notes: [], tokens_used: null,
        error: 'boom', lease_until: null, started_at: null, finished_at: null,
        created_at: '2026-07-02T06:00:00.000Z' },
      // Another owner's run for the same client id must NEVER appear.
      { id: 'r3', client_id: clientId, owner_user_id: 'owner-2', tick_type: 'daily',
        status: 'succeeded', attention: {}, actions: [], notes: [], tokens_used: null,
        error: null, lease_until: null, started_at: null, finished_at: null,
        created_at: '2026-07-03T06:00:00.000Z' },
    ]);

    const res = await GET(getReq(`?clientId=${clientId}`));
    expect(res.status).toBe(200);
    const payload: { runs: Array<{ id: string }> } = await res.json();
    expect(payload.runs.map((r) => r.id)).toEqual(['r2', 'r1']);
  });
});
