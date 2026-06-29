// Characterization tests for the AD ANALYSIS feature.
//
// These lock in what the code does TODAY (warts included). Companion to
// tests/landing-leads.test.ts and tests/images-content.test.ts; same strategy:
// drive the REAL route handler with mocked Supabase + mocked Anthropic/credits
// and assert the exact insert payloads. Coupling findings at the bottom.
//
// Three tables are in scope. Verified-against-source schema facts:
//
//  ad_performance        (002_features.sql:107-126) — Meta metrics CACHE, not AI analysis
//    id, user_id(FK,NOT NULL), client_id(FK meta_clients, NOT NULL), ad_account_id(text,NOT NULL),
//    date, impressions, clicks, spend, reach, frequency, ctr, cpc, cpm, conversions,
//    cost_per_result, roas, fetched_at;  UNIQUE(client_id, ad_account_id, date)
//    ► client_id ALWAYS populated. ad_account_id is ACCOUNT-level — there is NO ad_id /
//      specific-ad column. So it attributes to a client but never to a specific ad.
//
//  brief_analyses        (005_phase_c.sql:91-103) — AI analysis of a BRIEF
//    id, user_id(FK,NOT NULL), brief_id(FK briefs, on delete set null, NULLABLE),
//    completeness_score, strengths, gaps, questions, refinements, raw_text, created_at
//    ► NO client_id column. Client link is LATENT, two-hop: brief_id → briefs.client_id.
//      The UI DOES pass brief_id when a brief is picked (analyze-brief/page.tsx:42), null on paste.
//
//  weak_ad_analyses      (005_phase_c.sql:113-123) — AI analysis of a WEAK AD
//    id, user_id(FK,NOT NULL), ad_text(NOT NULL), metrics, diagnosis, root_causes,
//    improvements, rewritten_ad, created_at
//    ► NO client_id, NO brief_id, NO ad reference. The "ad" is free-text ad_text only.
//      Attribution to a client AND to a specific ad is ABSENT (like generated_images).
//
//  RLS on all three: "own" using auth.uid() = user_id.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const CANNED = [
  '[STRATEGIC_SUMMARY]',
  'goal: לידים',
  'core_offer: ליווי',
  'usp: ייחודי',
  'constraints:',
  '- אילוץ א',
  '[/STRATEGIC_SUMMARY]',
  '[SUB_AUDIENCE]',
  'name: קהל',
  'awareness: Problem-aware',
  'persona: פרסונה',
  'explanation: הסבר',
  '[/SUB_AUDIENCE]',
  '[PLATFORM_FUNNEL]',
  'platform: Meta',
  'ad_format: Reels',
  'funnel_type: lead-gen',
  'platform_reason: ר1',
  'format_reason: ר2',
  'funnel_reason: ר3',
  '[/PLATFORM_FUNNEL]',
  '[OFFER_STACK]',
  'components:',
  '- רכיב א',
  'strengths:',
  '- חוזקה א',
  '- חוזקה ב',
  'assessment: הערכה',
  '[/OFFER_STACK]',
  '[DIAGNOSIS]hook חלש[/DIAGNOSIS]',
  '[CAUSES]', '- סיבה א', '- סיבה ב', '[/CAUSES]',
  '[IMPROVEMENTS]', '- שיפור א', '- שיפור ב', '[/IMPROVEMENTS]',
  '[REWRITTEN]', 'מודעה משופרת', '[/REWRITTEN]',
].join('\n');

const H = vi.hoisted(() => ({
  cfg: { authUser: { id: 'owner-1' } as { id: string } | null },
  captured: {
    insert:        undefined as { table: string; payload: any } | undefined,
    aiCtxClientId: undefined as string | null | undefined,
    refundCalls:   [] as any[],
  },
}));

// Supabase: auth + insert capture (the analysis inserts use .insert().select().single())
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: H.cfg.authUser } }) },
    from(table: string) {
      const builder: any = {
        insert: (payload: any) => { H.captured.insert = { table, payload }; return builder; },
        select: () => builder,
        single: async () => ({ data: { id: 'new-id' } }),
      };
      return builder;
    },
  }),
}));

// Anthropic SDK (default export class). One canned response carries every tag;
// each tool's extractor picks out only its own.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: async () => ({ content: [{ type: 'text', text: CANNED }] }) };
  },
}));

// Credits: always succeed; record refunds so we can assert the charge-without-refund warts.
vi.mock('@/lib/credits', () => ({
  deductCredits:      async () => ({ ok: true, cost: 5, credits: 50 }),
  refundCredits:      async (...args: any[]) => { H.captured.refundCalls.push(args); },
  extractErrorMessage: (e: any) => e?.message ?? String(e),
}));

// AI context: stub to empty, but capture which clientId the route resolved + passed in.
vi.mock('@/lib/ai-context', () => ({
  buildAiContext: async (_sb: any, opts: any) => { H.captured.aiCtxClientId = opts?.clientId ?? null; return { combined: '' }; },
}));

function fakeReq(body: any, cookie = ''): any {
  return {
    json: async () => body,
    headers: { get: (k: string) => (k.toLowerCase() === 'cookie' ? cookie : null) },
  };
}

beforeEach(() => {
  H.cfg.authUser = { id: 'owner-1' };
  H.captured.insert        = undefined;
  H.captured.aiCtxClientId = undefined;
  H.captured.refundCalls   = [];
});

// ════════════════════════════════════════════════════════════════════
// 1. analyze_brief → brief_analyses (real handler)
// ════════════════════════════════════════════════════════════════════
describe('POST /api/tools analyze_brief — brief_analyses insert shape', () => {
  it('inserts parsed analysis with brief_id from input and NO client_id', async () => {
    const { POST } = await import('@/app/api/tools/route');
    const res = await POST(fakeReq({
      tool: 'analyze_brief',
      input: { values: { biz_name: 'Bloom' }, brief_id: 'brief-7' },
    }));

    expect(res.status).toBe(200);
    expect(H.captured.insert!.table).toBe('brief_analyses');
    // New StrategyAnalysis maps cleanly onto the legacy history columns:
    // strengths ← offer_stack.strengths, gaps ← strategic_summary.constraints,
    // raw_text retains the full strategy text.
    expect(H.captured.insert!.payload).toEqual({
      user_id:     'owner-1',
      brief_id:    'brief-7',
      strengths:   ['חוזקה א', 'חוזקה ב'],
      gaps:        ['אילוץ א'],
      questions:   [],
      refinements: [],
      raw_text:    CANNED,
    });
    expect('client_id' in H.captured.insert!.payload).toBe(false);
  });

  it('brief_id defaults to null when the input omits it (pasted-text path)', async () => {
    const { POST } = await import('@/app/api/tools/route');
    await POST(fakeReq({ tool: 'analyze_brief', input: { values: { biz_name: 'X' } } }));
    expect(H.captured.insert!.payload.brief_id).toBeNull();
  });

  it('the active client IS resolved and fed to the AI context, but is DROPPED at persistence', async () => {
    // brief_analyses has no client_id column, so the known active client never lands on the row.
    // readActiveClientCookie only accepts a 36-char UUID-format value.
    const CLIENT_UUID = '11111111-1111-1111-1111-111111111111';
    const { POST } = await import('@/app/api/tools/route');
    await POST(fakeReq(
      { tool: 'analyze_brief', input: { values: {}, brief_id: 'brief-7' } },
      `admaster_active_client=${CLIENT_UUID}`,
    ));
    expect(H.captured.aiCtxClientId).toBe(CLIENT_UUID);          // known
    expect('client_id' in H.captured.insert!.payload).toBe(false); // dropped
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. analyze_weak → weak_ad_analyses (real handler)
// ════════════════════════════════════════════════════════════════════
describe('POST /api/tools analyze_weak — weak_ad_analyses insert shape', () => {
  it('inserts free-text ad analysis with NO client_id, NO brief_id, NO specific-ad reference', async () => {
    const { POST } = await import('@/app/api/tools/route');
    const res = await POST(fakeReq({
      tool: 'analyze_weak',
      input: { ad_text: 'קנו עכשיו!', metrics: { ctr: 0.4, roas: 0.8 } },
    }));

    expect(res.status).toBe(200);
    expect(H.captured.insert!.table).toBe('weak_ad_analyses');
    expect(H.captured.insert!.payload).toEqual({
      user_id:      'owner-1',
      ad_text:      'קנו עכשיו!',
      metrics:      { ctr: 0.4, roas: 0.8 },
      diagnosis:    'hook חלש',
      root_causes:  ['סיבה א', 'סיבה ב'],
      improvements: ['שיפור א', 'שיפור ב'],
      rewritten_ad: 'מודעה משופרת',
    });
    // The only "ad" identity is the pasted text — no client_id, brief_id, ad_id, or ad_account_id.
    for (const k of ['client_id', 'brief_id', 'ad_id', 'ad_account_id']) {
      expect(k in H.captured.insert!.payload).toBe(false);
    }
  });

  it('WART: missing ad_text → 400, no insert — but credits were deducted and NOT refunded', async () => {
    // deductCredits runs before the per-tool validation; the 400 early-returns
    // without a refund. Locking the current (lossy) behavior.
    const { POST } = await import('@/app/api/tools/route');
    const res = await POST(fakeReq({ tool: 'analyze_weak', input: { ad_text: '   ' } }));
    expect(res.status).toBe(400);
    expect(H.captured.insert).toBeUndefined();
    expect(H.captured.refundCalls.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2c. offer_stack → offer_stacks (real handler) — active-client attribution
//     Unlike the two analysis tables above, offer_stacks HAS a client_id
//     column, and the route now defaults it to the active client (cookie),
//     mirroring the landing-page writer.
// ════════════════════════════════════════════════════════════════════
describe('POST /api/tools offer_stack — offer_stacks insert carries the active client', () => {
  // readActiveClientCookie only accepts a 36-char UUID-format value.
  const ACTIVE = '22222222-2222-2222-2222-222222222222';

  it('client_id defaults to the ACTIVE client (cookie) when the input omits it', async () => {
    // The offer-stack UI posts only { product, audience, outcome, current_price } —
    // never client_id. The route falls back to the active-client cookie, so offers
    // are born linked to the active client.
    const { POST } = await import('@/app/api/tools/route');
    const res = await POST(fakeReq(
      { tool: 'offer_stack', input: { product: 'קורס דיגיטל' } },
      `admaster_active_client=${ACTIVE}`,
    ));
    expect(res.status).toBe(200);
    expect(H.captured.insert!.table).toBe('offer_stacks');
    expect(H.captured.insert!.payload.client_id).toBe(ACTIVE);
    expect(H.captured.insert!.payload.user_id).toBe('owner-1');
    expect(H.captured.insert!.payload.brief_id).toBeNull();
  });

  it('explicit input client_id wins over the active-client cookie', async () => {
    const { POST } = await import('@/app/api/tools/route');
    await POST(fakeReq(
      { tool: 'offer_stack', input: { product: 'X', client_id: 'client-7' } },
      `admaster_active_client=${ACTIVE}`,
    ));
    expect(H.captured.insert!.payload.client_id).toBe('client-7');
  });

  it('client_id is NULL when neither the input nor an active client is present', async () => {
    const { POST } = await import('@/app/api/tools/route');
    await POST(fakeReq({ tool: 'offer_stack', input: { product: 'X' } })); // no cookie
    expect(H.captured.insert!.payload.client_id).toBeNull();
  });

  it('WART: missing product → 400, no insert (credits already deducted, not refunded)', async () => {
    const { POST } = await import('@/app/api/tools/route');
    const res = await POST(fakeReq({ tool: 'offer_stack', input: { product: '  ' } }));
    expect(res.status).toBe(400);
    expect(H.captured.insert).toBeUndefined();
    expect(H.captured.refundCalls.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Guards
// ════════════════════════════════════════════════════════════════════
describe('POST /api/tools — guards', () => {
  it('unauthenticated → 401, before any credit deduction or insert', async () => {
    H.cfg.authUser = null;
    const { POST } = await import('@/app/api/tools/route');
    const res = await POST(fakeReq({ tool: 'analyze_brief', input: {} }));
    expect(res.status).toBe(401);
    expect(H.captured.insert).toBeUndefined();
  });

  it('WART: unknown tool → 400 after credits were already deducted (deduct-before-validate)', async () => {
    const { POST } = await import('@/app/api/tools/route');
    const res = await POST(fakeReq({ tool: 'nonsense' as any, input: {} }));
    expect(res.status).toBe(400);
    expect(H.captured.insert).toBeUndefined();
    expect(H.captured.refundCalls.length).toBe(0); // charged, not refunded
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. ATTRIBUTION MODEL (pure logic) — what each table can be tied to today.
// ════════════════════════════════════════════════════════════════════

// 4a. brief_analyses → client is a LATENT two-hop via brief_id → briefs.client_id
// (identical shape to the leads chain). brief_id is populated when a brief is
// selected in the UI, null when text is pasted.
type Analysis = { id: string; brief_id: string | null };
type Brief    = { id: string; client_id: string | null };
function briefAnalysesPerClient(analyses: Analysis[], briefs: Brief[]): Record<string, number> {
  const briefToClient = new Map(briefs.map(b => [b.id, b.client_id]));
  const counts: Record<string, number> = {};
  for (const a of analyses) {
    const clientId = a.brief_id ? (briefToClient.get(a.brief_id) ?? null) : null;
    const bucket = clientId ?? '__unattributed__';
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

describe('attribution: brief_analyses → brief_id → briefs.client_id (two-hop, latent)', () => {
  it('analysis whose brief is linked to a client attributes to that client', () => {
    const briefs: Brief[] = [{ id: 'b1', client_id: 'client-A' }, { id: 'b2', client_id: null }];
    const analyses: Analysis[] = [
      { id: 'a1', brief_id: 'b1' },   // → client-A
      { id: 'a2', brief_id: 'b2' },   // brief has no client → unattributed
      { id: 'a3', brief_id: null },   // pasted text, no brief → unattributed
    ];
    expect(briefAnalysesPerClient(analyses, briefs)).toEqual({ 'client-A': 1, __unattributed__: 2 });
  });
});

// 4b. weak_ad_analyses — no client field at all (like generated_images). Every
// row is unattributed to client; and there is no specific-ad reference either.
type WeakRow = { id: string; ad_text: string };
function weakAdsPerClient(rows: WeakRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const _ of rows) counts['__no_client_field__'] = (counts['__no_client_field__'] ?? 0) + 1;
  return counts;
}

describe('attribution: weak_ad_analyses has neither client nor specific-ad linkage', () => {
  it('every weak-ad analysis is unattributable (only owner + free text)', () => {
    const rows: WeakRow[] = [{ id: 'w1', ad_text: 'a' }, { id: 'w2', ad_text: 'b' }];
    expect(weakAdsPerClient(rows)).toEqual({ __no_client_field__: 2 });
  });
});

// 4c. ad_performance — client_id is NOT NULL (always attributed to a client), but
// ad_account_id is ACCOUNT-level: no specific-ad attribution is possible.
describe('attribution: ad_performance is client-scoped but account-level (no specific ad)', () => {
  it('rows always carry client_id; the only ad dimension is the account, not an ad', () => {
    // Mirror of the real upsert payload (analytics/route.ts:67) + UNIQUE key.
    const row = { user_id: 'u1', client_id: 'client-A', ad_account_id: 'act_123', date: '2026-06-08' };
    expect(row.client_id).toBe('client-A');           // always present (NOT NULL)
    expect('ad_id' in row).toBe(false);               // no specific-ad column exists
    // UNIQUE(client_id, ad_account_id, date) → one aggregate row per account per day.
    const uniqueKey = `${row.client_id}|${row.ad_account_id}|${row.date}`;
    expect(uniqueKey).toBe('client-A|act_123|2026-06-08');
  });
});

// ════════════════════════════════════════════════════════════════════
// COUPLING FINDINGS — paths intentionally NOT driven here
// ════════════════════════════════════════════════════════════════════
// (a) ad_performance WRITE (analytics/route.ts:67) is an UPSERT behind the Meta
//     Graph API: getDecryptedMetaToken + fetchInsights/fetchCampaigns/fetchTopAds.
//     Too coupled to drive. Payload shape: {user_id, client_id, ad_account_id, date,
//     impressions, clicks, spend, reach, frequency, ctr, cpc, cpm} with
//     onConflict 'client_id,ad_account_id,date'. client_id ALWAYS set (from the
//     validated ?clientId query param). No specific-ad / ad_id field.
// (b) ad_performance READ: reports/route.ts:17 selects by client_id + date range;
//     analytics/route.ts requires a ?clientId param (404s without a matching client).
//     Both are strictly client-scoped reads.
// (c) The offer_stack tool (same route, table 'offer_stacks') IS now driven here
//     (section 2c): unlike the two analysis tables, offer_stacks has a client_id
//     column, and the route defaults it to the active client (cookie) —
//     client_id ?? activeClientId ?? null — mirroring the landing-page writer.
// (d) analyze_brief / analyze_weak history readers: the dashboards re-run analyses
//     rather than list saved rows; persisted analyses are owner-scoped via the
//     "own" RLS policy (no per-client read path exists for them).
