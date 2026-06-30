// Tests for app/api/intelligence/insights/route.ts — the READ endpoint backing
// the Client Intelligence page poll + post-signal refresh. Owner-scoped; returns
// the active atoms (all layers) + the strategy snapshot.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { makeFakeDb, type FakeDb } from './fake-admin';
import { CONFIDENCE, type ClientInsight } from '@/lib/intelligence/types';

const h = vi.hoisted(() => ({ db: null as FakeDb | null, userId: 'u1' as string | null }));

// The GET route uses the user client for auth + all reads (RLS owner-only). We
// back it with the same in-memory fake as the admin (identical query chains).
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.userId ? { id: h.userId } : null } }) },
    from: (table: string) => h.db!.admin.from(table),
  }),
}));

import { GET } from '@/app/api/intelligence/insights/route';

const insight = (over: Partial<ClientInsight> = {}): ClientInsight => ({
  id: 'i1', client_id: 'c1', owner_user_id: 'u1',
  layer: 'business', kind: 'real_usp', content: 'הליווי האישי', structured: null,
  source: 'brief', source_ref: null, confidence: CONFIDENCE.START, evidence_count: 1,
  status: 'active', superseded_by: null, superseded_reason: null,
  first_seen_at: 't', updated_at: 't', ...over,
});

function makeReq(clientId?: string): NextRequest {
  const url = clientId
    ? `http://localhost/api/intelligence/insights?clientId=${clientId}`
    : 'http://localhost/api/intelligence/insights';
  return new NextRequest(url);
}

beforeEach(() => { h.db = null; h.userId = 'u1'; });

describe('GET /api/intelligence/insights', () => {
  it('returns active insights (all layers) + strategy, owner-scoped', async () => {
    h.db = makeFakeDb({
      clients: [{ id: 'c1', owner_user_id: 'u1', name: 'לקוח' }],
      insights: [
        insight({ id: 'i1', layer: 'business', confidence: 0.9 }),
        insight({ id: 'i2', layer: 'customers', kind: 'unspoken_want', confidence: 0.6 }),
        insight({ id: 'i3', layer: 'bridge', confidence: 0.7 }),
        insight({ id: 'i4', layer: 'business', status: 'refuted', confidence: 0.4 }),
      ],
    });
    h.db.client_strategy.push({
      id: 's1', client_id: 'c1', owner_user_id: 'u1',
      business_analysis: { strategic_summary: { goal: 'g' } },
      avatar: null, core_generated_at: '2026-06-01T00:00:00Z', updated_at: 't',
    });

    const res = await GET(makeReq('c1'));
    const json = await res.json();

    // only active atoms; refuted excluded
    expect(json.insights.map((i: ClientInsight) => i.id).sort()).toEqual(['i1', 'i2', 'i3']);
    expect(json.coreGeneratedAt).toBe('2026-06-01T00:00:00Z');
    expect(json.strategy.business_analysis.strategic_summary.goal).toBe('g');
  });

  it('returns null strategy / coreGeneratedAt when none synthesized', async () => {
    h.db = makeFakeDb({ clients: [{ id: 'c1', owner_user_id: 'u1', name: 'לקוח' }] });
    const res = await GET(makeReq('c1'));
    const json = await res.json();
    expect(json.insights).toEqual([]);
    expect(json.strategy).toBeNull();
    expect(json.coreGeneratedAt).toBeNull();
  });

  it('401 when unauthenticated', async () => {
    h.db = makeFakeDb();
    h.userId = null;
    const res = await GET(makeReq('c1'));
    expect(res.status).toBe(401);
  });

  it('400 when clientId is missing', async () => {
    h.db = makeFakeDb();
    const res = await GET(makeReq());
    expect(res.status).toBe(400);
  });

  it('404 when the client is not owned by the user', async () => {
    h.db = makeFakeDb({ clients: [{ id: 'c1', owner_user_id: 'someone-else', name: 'x' }] });
    const res = await GET(makeReq('c1'));
    expect(res.status).toBe(404);
  });
});
