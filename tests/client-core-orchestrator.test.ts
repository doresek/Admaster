// Tests for lib/client-core/orchestrator.ts — the post-brief-submit core builder
// (Phase-A: analyze -> reconcile -> synthesize -> client_strategy).
//
// The analysis LLM is INJECTED (analyzeRun), so no API key/network is needed.
// The fake admin client is the shared in-memory DB (tests/intelligence/fake-admin)
// extended with briefs + a deduct_credits rpc. We assert:
//   (a) idempotency guard returns early when client_strategy.core_generated_at > submitted_at;
//   (b) force bypasses the guard;
//   (c) a fresh brief produces atoms (client_insights), a synthesized snapshot
//       (client_strategy.business_analysis + avatar + core_generated_at), and
//       deducts both credits;
//   (d) ownership mismatch / missing brief is a no-op.
import { describe, it, expect, vi } from 'vitest';
import { orchestrateClientCore } from '@/lib/client-core/orchestrator';
import { makeFakeDb } from './intelligence/fake-admin';

const ANALYSIS_RAW = [
  '[INSIGHTS]',
  'business | goal | לידים לקליניקה | 0.9 | מטרה מהבריף',
  'business | real_usp | מעקב אישי יומי | 0.85 | בידול מהבריף',
  'business | core_offer | ליווי 12 שבועות | 0.8 | ההצעה',
  'customers | pain | אין זמן להתאמן | 0.9 | כאב מרכזי',
  'customers | awareness | Problem-aware | 0.7 | מזהים כאב',
  'customers | persona | אמהות עסוקות | 0.8 | מי הלקוח',
  'customers | desire | להרגיש אנרגטית | 0.7 | רצון',
  'bridge | platform | Meta | 0.8 | קהל באינסטגרם',
  'bridge | funnel | lead-gen | 0.75 | חימום לפני מכירה',
  'bridge | angle | התחל בלי לשנות הכל | 0.7 | גשר',
  '[/INSIGHTS]',
].join('\n');

function makeAdmin(opts: { brief: any; strategySeed?: any[] }) {
  const db = makeFakeDb({
    clients: [{ id: 'c1', owner_user_id: 'u1' }],
    briefs:  opts.brief ? [{ id: 'b1', ...opts.brief }] : [],
  });
  for (const s of opts.strategySeed ?? []) db.client_strategy.push(s);
  return db;
}

describe('orchestrateClientCore (Phase-A)', () => {
  it('(a) idempotency guard: no-op when core_generated_at is newer than the brief', async () => {
    const db = makeAdmin({
      brief: { values: { biz_name: 'X' }, submitted_at: '2026-01-01T00:00:00Z', user_id: 'u1', client_id: 'c1' },
      strategySeed: [{ client_id: 'c1', owner_user_id: 'u1', core_generated_at: '2026-02-01T00:00:00Z' }],
    });
    const analyzeRun = vi.fn(async () => ANALYSIS_RAW);

    const result = await orchestrateClientCore(db.admin, { userId: 'u1', clientId: 'c1', briefId: 'b1', analyzeRun });

    expect(result).toEqual({ analysis: false, avatar: false });
    expect(analyzeRun).not.toHaveBeenCalled();
    expect(db.client_insights).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('(b) force=true bypasses the idempotency guard and rebuilds', async () => {
    const db = makeAdmin({
      brief: { values: { biz_name: 'X' }, submitted_at: '2026-01-01T00:00:00Z', user_id: 'u1', client_id: 'c1' },
      strategySeed: [{ client_id: 'c1', owner_user_id: 'u1', core_generated_at: '2026-02-01T00:00:00Z' }],
    });
    const result = await orchestrateClientCore(db.admin, {
      userId: 'u1', clientId: 'c1', briefId: 'b1', force: true, analyzeRun: async () => ANALYSIS_RAW,
    });
    expect(result).toEqual({ analysis: true, avatar: true });
    expect(db.client_insights.length).toBeGreaterThan(0);
  });

  it('(c) fresh brief: creates atoms, synthesizes client_strategy, deducts both credits', async () => {
    const db = makeAdmin({
      brief: { values: { biz_name: 'X', pain_main: 'אין זמן' }, submitted_at: '2026-03-01T00:00:00Z', user_id: 'u1', client_id: 'c1' },
    });
    const analyzeRun = vi.fn(async () => ANALYSIS_RAW);

    const result = await orchestrateClientCore(db.admin, { userId: 'u1', clientId: 'c1', briefId: 'b1', analyzeRun });

    expect(result).toEqual({ analysis: true, avatar: true });

    // atoms persisted across all 3 layers
    expect(db.client_insights.length).toBe(10);
    expect(db.client_insights.some((i) => i.layer === 'business')).toBe(true);
    expect(db.client_insights.some((i) => i.layer === 'customers')).toBe(true);
    expect(db.client_insights.some((i) => i.layer === 'bridge')).toBe(true);
    // every atom logged a 'created' event
    expect(db.insight_events.filter((e) => e.event === 'created')).toHaveLength(10);

    // synthesized snapshot written to client_strategy
    const strat = db.client_strategy.find((r) => r.client_id === 'c1');
    expect(strat).toBeTruthy();
    expect(strat.business_analysis.strategic_summary.goal).toBe('לידים לקליניקה');
    expect(strat.business_analysis.sub_audience.awareness_level).toBe('Problem-aware');
    expect(strat.business_analysis.platform_funnel.platform).toBe('Meta');
    expect(strat.avatar.pains).toContain('אין זמן להתאמן');
    expect(strat.core_generated_at).toBeTruthy();

    // both credits deducted (analyze + avatar)
    const actions = db.rpcCalls.filter((c) => c.fn === 'deduct_credits').map((c) => c.args.p_action);
    expect(actions).toContain('analyze_brief');
    expect(actions).toContain('avatar');
  });

  it('(c2) C6: empty analysis (no atoms) does NOT stamp readiness (no false ready-but-empty)', async () => {
    const db = makeAdmin({
      brief: { values: { biz_name: 'X' }, submitted_at: '2026-03-01T00:00:00Z', user_id: 'u1', client_id: 'c1' },
    });
    const result = await orchestrateClientCore(db.admin, {
      userId: 'u1', clientId: 'c1', briefId: 'b1', analyzeRun: async () => 'no insights here',
    });
    expect(result.analysis).toBe(false);
    expect(db.client_insights).toHaveLength(0);
    expect(db.rpcCalls.some((c) => c.args.p_action === 'analyze_brief')).toBe(false);
    // C6: with zero atoms we must NOT stamp a ready-but-empty snapshot — the dashboard
    // stays in "building/retry", not a false "ready".
    expect(db.client_strategy.find((r) => r.client_id === 'c1')?.core_generated_at).toBeFalsy();
  });

  it('(d) no-op when the brief does not belong to the user', async () => {
    const db = makeAdmin({ brief: null });
    const result = await orchestrateClientCore(db.admin, {
      userId: 'u1', clientId: 'c1', briefId: 'b1', analyzeRun: async () => ANALYSIS_RAW,
    });
    expect(result).toEqual({ analysis: false, avatar: false });
    expect(db.client_insights).toHaveLength(0);
  });

  // ---- S1: cross-tenant BOLA is refused (ownership verified under the admin client) ----
  it('(e) S1: refuses when the client is not owned by the caller', async () => {
    // client c1 belongs to u1; a different user u2 must not drive its core.
    const db = makeAdmin({
      brief: { values: { biz_name: 'X' }, submitted_at: '2026-03-01T00:00:00Z', user_id: 'u2', client_id: 'c1' },
    });
    const analyzeRun = vi.fn(async () => ANALYSIS_RAW);

    const result = await orchestrateClientCore(db.admin, { userId: 'u2', clientId: 'c1', briefId: 'b1', analyzeRun });

    expect(result).toEqual({ analysis: false, avatar: false });
    expect(analyzeRun).not.toHaveBeenCalled();
    expect(db.client_insights).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0); // never reached the build claim
  });

  it('(f) S1: refuses when the brief is linked to a different client (no null-brief bypass)', async () => {
    // caller owns both c1 and c2, but the brief is tied to c2 — cannot build c1 from it.
    const db = makeFakeDb({
      clients: [{ id: 'c1', owner_user_id: 'u1' }, { id: 'c2', owner_user_id: 'u1' }],
      briefs:  [{ id: 'b1', values: { biz_name: 'X' }, submitted_at: '2026-03-01T00:00:00Z', user_id: 'u1', client_id: 'c2' }],
    });
    const analyzeRun = vi.fn(async () => ANALYSIS_RAW);

    const result = await orchestrateClientCore(db.admin, { userId: 'u1', clientId: 'c1', briefId: 'b1', analyzeRun });

    expect(result).toEqual({ analysis: false, avatar: false });
    expect(analyzeRun).not.toHaveBeenCalled();
    expect(db.client_insights).toHaveLength(0);
  });

  // ---- C1: a lost build claim is a no-op (no duplicate atoms, no double charge) ----
  it('(g) C1: does not build when the per-client claim is already held', async () => {
    const db = makeAdmin({
      brief: { values: { biz_name: 'X' }, submitted_at: '2026-03-01T00:00:00Z', user_id: 'u1', client_id: 'c1' },
    });
    // Simulate another in-flight build holding the claim: claim_client_build returns false.
    const origRpc = db.admin.rpc;
    db.admin.rpc = (fn: string, args: any) =>
      fn === 'claim_client_build'
        ? Promise.resolve({ data: false, error: null })
        : origRpc(fn, args);
    const analyzeRun = vi.fn(async () => ANALYSIS_RAW);

    const result = await orchestrateClientCore(db.admin, { userId: 'u1', clientId: 'c1', briefId: 'b1', force: true, analyzeRun });

    expect(result).toEqual({ analysis: false, avatar: false });
    expect(analyzeRun).not.toHaveBeenCalled();          // never analyzed
    expect(db.client_insights).toHaveLength(0);          // no duplicate atoms
    expect(db.rpcCalls.some((c) => c.fn === 'deduct_credits')).toBe(false); // no double charge
  });
});
