// Tests for app/api/intelligence/signal/route.ts — the user-signal loop:
// insert a learning_signal → apply lifecycle to the linked insight(s) → mark
// processed → re-synthesize the strategy snapshot.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeFakeDb, type FakeDb } from './fake-admin';
import { CONFIDENCE, type ClientInsight } from '@/lib/intelligence/types';

// Hoisted holder so the vi.mock factory can hand the route the per-test fake db.
const h = vi.hoisted(() => ({ db: null as FakeDb | null, userId: 'u1' }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: h.userId } } }) },
  }),
  createAdminClient: () => h.db!.admin,
}));

import { POST } from '@/app/api/intelligence/signal/route';

const insight = (over: Partial<ClientInsight> = {}): ClientInsight => ({
  id: 'i1', client_id: 'c1', owner_user_id: 'u1',
  layer: 'business', kind: 'real_usp', content: 'הליווי האישי', structured: null,
  source: 'brief', source_ref: null, confidence: CONFIDENCE.START, evidence_count: 1,
  status: 'active', superseded_by: null, superseded_reason: null,
  first_seen_at: 't', updated_at: 't', ...over,
});

function makeReq(body: any): any {
  return new Request('http://localhost/api/intelligence/signal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => { h.db = null; h.userId = 'u1'; });

describe('POST /api/intelligence/signal', () => {
  it('worked: creates a positive learning_signal, corroborates the artifact insights, re-synthesizes', async () => {
    h.db = makeFakeDb({
      insights:  [insight({ id: 'i1', confidence: 0.5, evidence_count: 1 })],
      artifacts: [{ id: 'a1', client_id: 'c1', owner_user_id: 'u1', insight_ids: ['i1'], type: 'post' }],
    });

    const res = await POST(makeReq({ artifactId: 'a1', kind: 'worked' }));
    const json = await res.json();

    // 1) a learning_signals row was created (user_worked / positive / weight 0.8) and processed
    expect(h.db.learning_signals).toHaveLength(1);
    const sig = h.db.learning_signals[0];
    expect(sig.signal_type).toBe('user_worked');
    expect(sig.polarity).toBe('positive');
    expect(sig.weight).toBe(0.8);
    expect(sig.artifact_id).toBe('a1');
    expect(sig.processed).toBe(true);

    // 2) lifecycle applied to the linked insight (corroborated +0.12*0.8 ≈ 0.596) + event
    expect(h.db.client_insights[0].confidence).toBeCloseTo(0.596, 3);
    expect(h.db.client_insights[0].evidence_count).toBe(2);
    expect(h.db.insight_events.some((e) => e.event === 'corroborated' && e.signal_id === sig.id)).toBe(true);

    // 3) strategy re-synthesized
    expect(h.db.client_strategy).toHaveLength(1);
    expect(h.db.client_strategy[0].client_id).toBe('c1');

    // 4) response carries the updated insight summaries
    expect(json.ok).toBe(true);
    expect(json.applied).toBe(1);
    expect(json.insights[0].id).toBe('i1');
    expect(json.insights[0].status).toBe('active');
  });

  it('wrong (decisive): refutes the insight and records a negative signal', async () => {
    h.db = makeFakeDb({
      insights:  [insight({ id: 'i1', confidence: 0.8, evidence_count: 3 })],
      artifacts: [{ id: 'a1', client_id: 'c1', owner_user_id: 'u1', insight_ids: ['i1'], type: 'post' }],
    });

    const res = await POST(makeReq({ artifactId: 'a1', kind: 'wrong', detail: 'הקמפיין נכשל' }));
    const json = await res.json();

    expect(h.db.learning_signals[0].signal_type).toBe('user_wrong');
    expect(h.db.learning_signals[0].polarity).toBe('negative');
    // weight 0.8 >= DECISIVE_WEIGHT (0.70) → refuted
    expect(h.db.client_insights[0].status).toBe('refuted');
    expect(h.db.insight_events.some((e) => e.event === 'refuted')).toBe(true);
    expect(json.insights[0].status).toBe('refuted');
  });

  it('accepts a direct insightId (no artifact) and applies the signal', async () => {
    h.db = makeFakeDb({ insights: [insight({ id: 'i9', confidence: 0.5 })] });
    const res = await POST(makeReq({ insightId: 'i9', kind: 'worked' }));
    const json = await res.json();
    expect(h.db.learning_signals[0].insight_id).toBe('i9');
    expect(json.applied).toBe(1);
    expect(h.db.client_insights[0].confidence).toBeGreaterThan(0.5);
  });

  it('rejects an invalid kind', async () => {
    h.db = makeFakeDb();
    const res = await POST(makeReq({ insightId: 'i1', kind: 'maybe' }));
    expect(res.status).toBe(400);
  });

  it('404s when the artifact is not owned by the user', async () => {
    h.db = makeFakeDb({
      artifacts: [{ id: 'a1', client_id: 'c1', owner_user_id: 'someone-else', insight_ids: ['i1'] }],
    });
    const res = await POST(makeReq({ artifactId: 'a1', kind: 'worked' }));
    expect(res.status).toBe(404);
  });
});
