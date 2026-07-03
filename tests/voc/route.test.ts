// tests/voc/route.test.ts — POST /api/voc cost/DoS gating (SECURITY-AUDIT-2 F2):
// per-user durable rate limit + up-front credit deduction with refund on the
// provider path failing. Credits, rate-limit and the LLM pipeline are mocked.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

const h = vi.hoisted(() => ({
  userId: 'u1' as string | null,
  ownedClient: { id: '11111111-1111-1111-1111-111111111111', name: 'Acme' } as { id: string; name: string | null } | null,
  rl: { ok: true, remaining: 19, retryAfter: 0 } as { ok: boolean; remaining: number; retryAfter: number },
  deduct: { ok: true, cost: 5, credits: 100 } as
    | { ok: true; cost: number; credits: number }
    | { ok: false; status: number; error: string; credits?: number },
  ingestResult: { ok: true, deduped: false, document_id: 'd1', status: 'reconciled', quote_count: 3 } as { ok: boolean; [k: string]: unknown },
  ingestCalls: 0,
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

vi.mock('@/lib/voc', () => ({
  createAnthropicLlm: () => ({}),
  ingestDocument: vi.fn(async () => { h.ingestCalls++; return h.ingestResult; }),
  getQuoteBank: async () => [],
}));

import { POST } from '@/app/api/voc/route';

function makeReq(body: unknown): any {
  return new Request('http://localhost/api/voc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validBody = { clientId: CLIENT_ID, source: 'own_reviews', rawText: 'great product, loved it' };

beforeEach(() => {
  h.userId = 'u1';
  h.ownedClient = { id: CLIENT_ID, name: 'Acme' };
  h.rl = { ok: true, remaining: 19, retryAfter: 0 };
  h.deduct = { ok: true, cost: 5, credits: 100 };
  h.ingestResult = { ok: true, deduped: false, document_id: 'd1', status: 'reconciled', quote_count: 3 };
  h.ingestCalls = 0;
  h.refundCalls = 0;
});

describe('POST /api/voc — cost/DoS gating', () => {
  it('refuses (402) when the user is out of credits, and never calls the LLM', async () => {
    h.deduct = { ok: false, status: 402, error: 'insufficient_credits', credits: 0 };
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(402);
    const json = await res.json();
    expect(json.error).toBe('insufficient_credits');
    expect(h.ingestCalls).toBe(0);   // no provider spend when credits are gone
  });

  it('refuses (429) when rate-limited, before deducting credits or calling the LLM', async () => {
    h.rl = { ok: false, remaining: 0, retryAfter: 60 };
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(h.ingestCalls).toBe(0);
  });

  it('deducts + runs the pipeline on the happy path (200) and returns the credit balance', async () => {
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.credits).toBe(100);
    expect(h.ingestCalls).toBe(1);
    expect(h.refundCalls).toBe(0);
  });

  it('refunds the credits when the provider pipeline fails (502)', async () => {
    h.ingestResult = { ok: false, document_id: null, stage: 'extract', error: 'anthropic 529' };
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(502);
    expect(h.refundCalls).toBe(1);
  });
});
