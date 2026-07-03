// tests/competitor-watch/route.test.ts — POST /api/competitor-watch (paste)
// cost/DoS gating (SECURITY-AUDIT-2 F2): per-user durable rate limit +
// up-front credit deduction with refund when the decode wholly failed.
// Credits, rate-limit and the competitor-watch pipeline are mocked.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const ENTITY_ID = '22222222-2222-2222-2222-222222222222';

const h = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  ownedClient: { id: '11111111-1111-1111-1111-111111111111' } as { id: string } | null,
  rl: { ok: true, remaining: 19, retryAfter: 0 } as { ok: boolean; remaining: number; retryAfter: number },
  deduct: { ok: true, cost: 5, credits: 100 } as
    | { ok: true; cost: number; credits: number }
    | { ok: false; status: number; error: string; credits?: number },
  runResult: {
    delta: {}, map: { angles: [] }, flags: [], atomActions: [],
    errors: [] as Array<{ stage: string; error: string }>,
    decoded_count: 5, decode_dropped: [], ads_capped: 0,
  } as Record<string, unknown>,
  runCalls: 0,
  refundCalls: 0,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.userId ? { id: h.userId } : null } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.ownedClient }) }) }),
    }),
  }),
  createAdminClient: () => ({}),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimitDurable: vi.fn(async () => h.rl),
}));

vi.mock('@/lib/credits', () => ({
  deductCredits: vi.fn(async () => h.deduct),
  refundCredits: vi.fn(async () => { h.refundCalls++; }),
}));

vi.mock('@/lib/competitor-watch', () => ({
  ManualPasteFetcher: class {
    constructor(public raw: string) {}
    fetch() { return Promise.resolve({ ads: [], source: 'manual_paste' }); }
  },
  createAnthropicLlm: () => ({}),
  listEntities: vi.fn(async () => [{ id: ENTITY_ID, active: true }]),
  runWatch: vi.fn(async () => { h.runCalls++; return h.runResult; }),
  // Imported at module load but unused by the paste path:
  buildCoverageMap: () => ({ angles: [] }),
  isCompetitorAngle: () => false,
  listAds: async () => [],
  setEntityActive: async () => ({ ok: true }),
  strategicFlags: () => [],
  upsertEntity: async () => ({ ok: true }),
}));

import { POST } from '@/app/api/competitor-watch/route';

function makeReq(body: unknown): any {
  return new Request('http://localhost/api/competitor-watch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const pasteBody = { action: 'paste', clientId: CLIENT_ID, entityId: ENTITY_ID, rawText: 'מודעה אחת\n\nמודעה שתיים' };

beforeEach(() => {
  h.userId = 'u1';
  h.ownedClient = { id: CLIENT_ID };
  h.rl = { ok: true, remaining: 19, retryAfter: 0 };
  h.deduct = { ok: true, cost: 5, credits: 100 };
  h.runResult = {
    delta: {}, map: { angles: [] }, flags: [], atomActions: [],
    errors: [], decoded_count: 5, decode_dropped: [], ads_capped: 0,
  };
  h.runCalls = 0;
  h.refundCalls = 0;
});

describe('POST /api/competitor-watch (paste) — cost/DoS gating', () => {
  it('refuses (402) when the user is out of credits, and never runs the watch', async () => {
    h.deduct = { ok: false, status: 402, error: 'insufficient_credits', credits: 0 };
    const res = await POST(makeReq(pasteBody));
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error).toBe('insufficient_credits');
    expect(h.runCalls).toBe(0);   // no batched Anthropic decode when credits are gone
  });

  it('refuses (429) when rate-limited, before deducting credits or running the watch', async () => {
    h.rl = { ok: false, remaining: 0, retryAfter: 60 };
    const res = await POST(makeReq(pasteBody));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(h.runCalls).toBe(0);
  });

  it('deducts + runs the watch on the happy path (200) and returns the credit balance', async () => {
    const res = await POST(makeReq(pasteBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.credits).toBe(100);
    expect(h.runCalls).toBe(1);
    expect(h.refundCalls).toBe(0);
  });

  it('refunds when the decode wholly failed (nothing decoded + a decode-stage error)', async () => {
    h.runResult = {
      delta: {}, map: { angles: [] }, flags: [], atomActions: [],
      errors: [{ stage: 'decode', error: 'provider unavailable' }],
      decoded_count: 0, decode_dropped: [], ads_capped: 0,
    };
    const res = await POST(makeReq(pasteBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(h.refundCalls).toBe(1);
    expect(json.credits).toBe(105);   // balance after refund credited back
  });
});
