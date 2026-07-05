// Tests for GET/POST /api/economics — MOCKED Supabase + store, no live DB.
//
// Proves the route contract: auth (401), input validation (400s with Hebrew
// field errors on the onboarding answers), clients-table ownership (404),
// derived numbers computed from the stored row by the REAL core math
// (break-even, value-per-lead, gates from cac/monthlyContribution params),
// and that the store is called with the AUTHED user's id — never a
// caller-supplied owner.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { ClientEconomicsRow } from '@/lib/capability-contracts';
import type { UpsertEconomicsInput, UpsertEconomicsResult } from '@/lib/economics';

const CLIENT = '11111111-1111-1111-1111-111111111111';

interface RouteHarness {
  authUser:      { id: string } | null;
  owned:         { id: string } | null;
  economicsRow:  ClientEconomicsRow | null;
  upsertResult:  UpsertEconomicsResult | null;
  upsertCalls:   UpsertEconomicsInput[];
  getCalls:      Array<{ clientId: string; ownerUserId: string }>;
}

const H = vi.hoisted((): RouteHarness => ({
  authUser:     { id: 'owner-1' },
  owned:        { id: '11111111-1111-1111-1111-111111111111' },
  economicsRow: null,
  upsertResult: null,
  upsertCalls:  [],
  getCalls:     [],
}));

// Cookie-authed user client: the route uses it for auth.getUser() and the
// clients-table ownership check only (the store layer is mocked below).
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: H.authUser } }) },
    from: (_table: string) => ({
      select: (_cols?: string) => ({
        eq: (_col: string, _val: unknown) => ({
          maybeSingle: async () => ({ data: H.owned, error: null }),
        }),
      }),
    }),
  }),
}));

// The store module is mocked (its own behavior is proven in
// lib/economics/__tests__/store.test.ts); the CORE math re-exported through
// lib/economics stays REAL, so `derived` in the responses is real math.
vi.mock('@/lib/economics/store', () => ({
  ECONOMICS_COLUMNS: 'mocked-columns',
  getEconomics: async (_sb: unknown, clientId: string, ownerUserId: string) => {
    H.getCalls.push({ clientId, ownerUserId });
    return H.economicsRow;
  },
  upsertEconomics: async (_sb: unknown, input: UpsertEconomicsInput): Promise<UpsertEconomicsResult> => {
    H.upsertCalls.push(input);
    if (H.upsertResult) return H.upsertResult;
    return {
      ok:  true,
      row: {
        id:                      'econ-1',
        client_id:               input.clientId,
        owner_user_id:           input.ownerUserId,
        contribution_margin_pct: input.contributionMarginPct,
        avg_deal_value:          input.avgDealValue,
        close_rate_pct:          input.closeRatePct,
        payback_target_months:   input.paybackTargetMonths ?? 6,
        currency:                input.currency ?? 'ILS',
        source:                  'owner',
        updated_at:              '2026-07-06T00:00:00Z',
        created_at:              '2026-07-06T00:00:00Z',
      },
    };
  },
  refreshComputed: async () => {
    throw new Error('refreshComputed must not be called by this route');
  },
}));

import { GET, POST } from '@/app/api/economics/route';

const storedRow = (over: Partial<ClientEconomicsRow> = {}): ClientEconomicsRow => ({
  id:                      'econ-1',
  client_id:               CLIENT,
  owner_user_id:           'owner-1',
  contribution_margin_pct: 40,
  avg_deal_value:          2000,
  close_rate_pct:          20,
  payback_target_months:   6,
  currency:                'ILS',
  source:                  'owner',
  updated_at:              '2026-07-06T00:00:00Z',
  created_at:              '2026-07-06T00:00:00Z',
  ...over,
});

const getReq = (query: string) => new NextRequest(`http://test/api/economics${query}`);
const postReq = (body: Record<string, unknown>) =>
  new NextRequest('http://test/api/economics', {
    method:  'POST',
    body:    JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

const validAnswers = {
  clientId:              CLIENT,
  contributionMarginPct: 40,
  avgDealValue:          2000,
  closeRatePct:          20,
};

beforeEach(() => {
  H.authUser     = { id: 'owner-1' };
  H.owned        = { id: CLIENT };
  H.economicsRow = null;
  H.upsertResult = null;
  H.upsertCalls  = [];
  H.getCalls     = [];
});

describe('GET /api/economics', () => {
  it('401s when unauthenticated', async () => {
    H.authUser = null;
    const res = await GET(getReq(`?clientId=${CLIENT}`));
    expect(res.status).toBe(401);
  });

  it('400s on a non-UUID clientId', async () => {
    const res = await GET(getReq('?clientId=not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('400s on a bad cac / monthlyContribution param', async () => {
    expect((await GET(getReq(`?clientId=${CLIENT}&cac=-5`))).status).toBe(400);
    expect((await GET(getReq(`?clientId=${CLIENT}&cac=abc`))).status).toBe(400);
    expect((await GET(getReq(`?clientId=${CLIENT}&monthlyContribution=0`))).status).toBe(400);
  });

  it('404s when the client is not owned by the caller', async () => {
    H.owned = null;
    const res = await GET(getReq(`?clientId=${CLIENT}`));
    expect(res.status).toBe(404);
    expect(H.getCalls).toEqual([]); // no store read before ownership clears
  });

  it('reads the store scoped to the AUTHED user, not any caller-supplied owner', async () => {
    await GET(getReq(`?clientId=${CLIENT}`));
    expect(H.getCalls).toEqual([{ clientId: CLIENT, ownerUserId: 'owner-1' }]);
  });

  it('no economics row yet → economics null, derived all null (never a 500)', async () => {
    const res = await GET(getReq(`?clientId=${CLIENT}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      economics: null,
      derived:   { break_even_roas: null, value_per_lead: null, gates: null },
    });
  });

  it('full row → derived break-even 2.5 and value-per-lead ₪160 (real core math)', async () => {
    H.economicsRow = storedRow();
    const res = await GET(getReq(`?clientId=${CLIENT}`));
    const data = await res.json();
    expect(data.derived.break_even_roas).toBe(2.5); // 100 / 40% margin
    expect(data.derived.value_per_lead).toBe(160);  // 20% × 2000 × 40%
    expect(data.derived.gates).toBeNull();          // no cac/monthlyContribution given
  });

  it('partial row (margin only) → break-even computed, value-per-lead null', async () => {
    H.economicsRow = storedRow({ avg_deal_value: null, close_rate_pct: null });
    const res = await GET(getReq(`?clientId=${CLIENT}`));
    const data = await res.json();
    expect(data.derived.break_even_roas).toBe(2.5);
    expect(data.derived.value_per_lead).toBeNull();
  });

  it('cac + monthlyContribution → BOTH services gates evaluated (pass case)', async () => {
    H.economicsRow = storedRow(); // ltv = 2000 × 40% = 800
    const res = await GET(getReq(`?clientId=${CLIENT}&cac=100&monthlyContribution=100`));
    const { derived } = await res.json();
    // LTV:CAC = 800/100 = 8 ≥ 4 · payback = 100/100 = 1 ≤ 6 → pass.
    expect(derived.gates.pass).toBe(true);
    expect(derived.gates.ltvCacRatio).toBe(8);
    expect(derived.gates.paybackMonths).toBe(1);
  });

  it('gates fail the LTV:CAC leg with the Hebrew reason naming the ratio', async () => {
    H.economicsRow = storedRow(); // ltv = 800
    const res = await GET(getReq(`?clientId=${CLIENT}&cac=400&monthlyContribution=50`));
    const { derived } = await res.json();
    // LTV:CAC = 800/400 = 2 < 4 → fail; payback = 400/50 = 8 > 6 → fail too.
    expect(derived.gates.pass).toBe(false);
    expect(derived.gates.failures.map((f: { gate: string }) => f.gate)).toEqual(['ltv_cac', 'payback']);
  });
});

describe('POST /api/economics', () => {
  it('401s when unauthenticated', async () => {
    H.authUser = null;
    const res = await POST(postReq(validAnswers));
    expect(res.status).toBe(401);
    expect(H.upsertCalls).toEqual([]);
  });

  it('400s on a non-UUID clientId', async () => {
    const res = await POST(postReq({ ...validAnswers, clientId: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('400s with a Hebrew field error when an answer is not a number — no write', async () => {
    const res = await POST(postReq({ ...validAnswers, contributionMarginPct: '40' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.errors[0].field).toBe('contributionMarginPct');
    expect(data.errors[0].message).toMatch(/[֐-׿]/);
    expect(H.upsertCalls).toEqual([]);
  });

  it('400s when a missing answer is omitted entirely', async () => {
    const res = await POST(postReq({ clientId: CLIENT, contributionMarginPct: 40 }));
    expect(res.status).toBe(400);
    expect(H.upsertCalls).toEqual([]);
  });

  it('400s on a non-number paybackTargetMonths / non-string currency', async () => {
    expect((await POST(postReq({ ...validAnswers, paybackTargetMonths: '6' }))).status).toBe(400);
    expect((await POST(postReq({ ...validAnswers, currency: 5 }))).status).toBe(400);
    expect(H.upsertCalls).toEqual([]);
  });

  it('404s when the client is not owned — no write', async () => {
    H.owned = null;
    const res = await POST(postReq(validAnswers));
    expect(res.status).toBe(404);
    expect(H.upsertCalls).toEqual([]);
  });

  it('400s with the store\'s typed validation errors (range violations)', async () => {
    H.upsertResult = {
      ok:     false,
      errors: [{ field: 'contributionMarginPct', message: 'שולי תרומה חייבים להיות מספר בין 0 ל-100 (לא כולל 0)' }],
    };
    const res = await POST(postReq({ ...validAnswers, contributionMarginPct: 0 }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.errors[0].field).toBe('contributionMarginPct');
  });

  it('seeds the answers under the AUTHED owner and returns the row + real derived math', async () => {
    const res = await POST(postReq({ ...validAnswers, paybackTargetMonths: 12, currency: 'USD' }));
    expect(res.status).toBe(200);

    expect(H.upsertCalls).toEqual([{
      clientId:              CLIENT,
      ownerUserId:           'owner-1', // from auth — never from the body
      contributionMarginPct: 40,
      avgDealValue:          2000,
      closeRatePct:          20,
      paybackTargetMonths:   12,
      currency:              'USD',
    }]);

    const data = await res.json();
    expect(data.economics.source).toBe('owner');
    expect(data.derived.break_even_roas).toBe(2.5); // 100/40
    expect(data.derived.value_per_lead).toBe(160);  // 20% × 2000 × 40%
    expect(data.derived.gates).toBeNull();
  });
});
