// Tests for buildAiContext snapshot emission (Phase-A write re-point).
//
// buildAiContext now reads:
//   • identity   ← clients (id, name)
//   • snapshot   ← client_strategy (business_analysis + avatar + core_generated_at)
//   • atoms      ← client_insights (top active per layer)
// and NO LONGER reads meta_clients.business_analysis/.avatar (a prod latent-fail).
//
// Locks in:
//   (1) NEW StrategyAnalysis snapshot emits the MARKETING STRATEGY block;
//   (2) LEGACY completeness-shape snapshot still renders;
//   (3) structured avatar + business_analysis both emit;
//   (4) no snapshot + legacy briefs.avatar renders the legacy text fallback;
//   (5) the LIVING INSIGHTS block renders from active atoms;
//   (6) NO meta_clients read remains.

import { describe, it, expect, vi } from 'vitest';
import { buildAiContext } from '@/lib/ai-context';

// Mock builder: chainable, and BOTH thenable (await -> list) AND terminal
// (maybeSingle/single -> first row). `order()` stays chainable so briefs'
// order().limit().maybeSingle() works, while client_insights' `await ...order()`
// resolves to the full array via the thenable.
function makeSupabase(tables: Record<string, { data: any }>) {
  const seen: string[] = [];
  const sb = {
    _tablesSeen: seen,
    from(table: string) {
      seen.push(table);
      const result = tables[table] ?? { data: null };
      const list = () => (Array.isArray(result.data) ? result.data : result.data == null ? [] : [result.data]);
      const one = () =>
        Promise.resolve(Array.isArray(result.data) ? { data: result.data[0] ?? null, error: null } : { ...result, error: null });
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: one,
        single: one,
        then: (resolve: any) => resolve({ data: list(), error: null }),
      };
      return builder;
    },
  } as any;
  return sb;
}

const USER_ID = 'user-1';
const CLIENT_ID = 'client-1';

const BA_MARKER = '═══ BUSINESS ANALYSIS ═══';
const AVATAR_MARKER = '═══ CLIENT AVATAR ═══';
const STRATEGY_MARKER = '═══ MARKETING STRATEGY ═══';
const INSIGHTS_MARKER = '═══ LIVING INSIGHTS';

const identity = { data: { id: CLIENT_ID, name: 'Bloom' } };

describe('buildAiContext: MARKETING STRATEGY snapshot (client_strategy) + legacy fallback', () => {
  it('(1) NEW strategy-shape business_analysis emits MARKETING STRATEGY + all 4 section markers', async () => {
    const supabase = makeSupabase({
      clients: identity,
      client_strategy: {
        data: {
          core_generated_at: '2026-06-20T00:00:00Z',
          business_analysis: {
            strategic_summary: {
              goal: 'לידים לקליניקה', core_offer: 'ליווי 12 שבועות', usp: 'מעקב אישי יומי',
              constraints: ['תקציב מוגבל', 'עונתיות', 'c3', 'c4', 'c5', 'c6-capped'],
            },
            sub_audience: { name: 'אמהות עסוקות', awareness_level: 'Problem-aware', persona: 'עובדות, חסרות זמן', explanation: 'מרגישות כאב' },
            platform_funnel: { platform: 'Meta', ad_format: 'Reels', funnel_type: 'lead-gen', platform_reason: 'אינסטגרם', format_reason: 'וידאו', funnel_reason: 'מחיר גבוה' },
            offer_stack: { components: ['ליווי אישי', 'קבוצה'], strengths: ['אחריות כפולה', 'ערך גבוה'], assessment: 'הצעה חזקה' },
          },
          avatar: null,
        },
      },
      briefs: { data: [] },
      client_insights: { data: [] },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });

    expect(ctx.combined).toContain(STRATEGY_MARKER);
    expect(ctx.combined).toContain('[STRATEGIC SUMMARY]');
    expect(ctx.combined).toContain('[SUB-AUDIENCE]');
    expect(ctx.combined).toContain('[PLATFORM & FUNNEL]');
    expect(ctx.combined).toContain('[OFFER STACK]');
    expect(ctx.combined).toContain('goal: לידים לקליניקה');
    expect(ctx.combined).toContain('awareness: Problem-aware');
    expect(ctx.combined).toContain('platform: Meta');
    expect(ctx.combined).toContain('strengths: אחריות כפולה | ערך גבוה');
    expect(ctx.combined).not.toContain('c6-capped'); // arrays capped at 5
    expect(ctx.combined).not.toContain(BA_MARKER);
    // and it must NOT read the legacy meta_clients table
    expect(supabase._tablesSeen).not.toContain('meta_clients');
  });

  it('(2) LEGACY completeness-shape snapshot still renders, emits NO strategy markers', async () => {
    const supabase = makeSupabase({
      clients: identity,
      client_strategy: {
        data: {
          core_generated_at: '2026-05-01T00:00:00Z',
          business_analysis: { completeness_score: 71, strengths: ['s1'], gaps: ['g1'], questions: ['q1'], refinements: ['r1'] },
          avatar: null,
        },
      },
      briefs: { data: [] },
      client_insights: { data: [] },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });
    expect(ctx.combined).toContain(BA_MARKER);
    expect(ctx.combined).toContain('completeness_score: 71');
    expect(ctx.combined).not.toContain(STRATEGY_MARKER);
  });
});

describe('buildAiContext: structured AVATAR + living insights', () => {
  it('(3) snapshot WITH avatar + business_analysis emits both blocks', async () => {
    const supabase = makeSupabase({
      clients: identity,
      client_strategy: {
        data: {
          core_generated_at: '2026-06-01T00:00:00Z',
          business_analysis: { completeness_score: 82, strengths: ['s1', 's2', 's3', 's4', 's5', 's6-capped'], gaps: ['g1'], refinements: ['r1'] },
          avatar: {
            name: 'Dana the Bride', age: 29, occupation: 'event planner',
            pains: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6-capped'], desires: ['d1'], fears: ['f1'], objections: ['o1'],
            awareness_level: '3 - solution aware', recommended_angle: 'aspirational lifestyle',
            recommended_creative_angles: ['soft pastels', 'natural light'],
          },
        },
      },
      briefs: { data: [] },
      client_insights: { data: [] },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });
    expect(ctx.combined).toContain(BA_MARKER);
    expect(ctx.combined).toContain(AVATAR_MARKER);
    expect(ctx.combined).toContain('completeness_score: 82');
    expect(ctx.combined).toContain('name: Dana the Bride');
    expect(ctx.combined).toContain('recommended_angle: aspirational lifestyle');
    expect(ctx.combined).toContain('recommended_creative_angles: soft pastels | natural light');
    expect(ctx.combined).not.toContain('s6-capped');
    expect(ctx.combined).not.toContain('p6-capped');
    expect(ctx.combined.indexOf(BA_MARKER)).toBeLessThan(ctx.combined.indexOf(AVATAR_MARKER));
  });

  it('(4) NO snapshot but legacy briefs.avatar renders the legacy block, NO new markers', async () => {
    const supabase = makeSupabase({
      clients: identity,
      client_strategy: { data: null },
      briefs: {
        data: [{ values: { biz_name: 'Bloom', biz_what: 'fresh flowers' }, avatar: 'LEGACY AVATAR: a 35yo bride', ads: null, funnel: null, status: 'has_avatar' }],
      },
      client_insights: { data: [] },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });
    expect(ctx.combined).toContain('Saved customer avatar');
    expect(ctx.combined).toContain('LEGACY AVATAR: a 35yo bride');
    expect(ctx.combined).not.toContain(BA_MARKER);
    expect(ctx.combined).not.toContain(AVATAR_MARKER);
  });

  it('(5) emits the LIVING INSIGHTS block from active atoms, grouped by layer', async () => {
    const supabase = makeSupabase({
      clients: identity,
      client_strategy: { data: null },
      briefs: { data: [] },
      client_insights: {
        data: [
          { layer: 'business', kind: 'real_usp', content: 'מעקב אישי יומי', confidence: 0.85 },
          { layer: 'customers', kind: 'pain', content: 'אין זמן להתאמן', confidence: 0.9 },
          { layer: 'bridge', kind: 'angle', content: 'התחל בלי לשנות הכל', confidence: 0.7 },
        ],
      },
    });

    const ctx = await buildAiContext(supabase, { userId: USER_ID, clientId: CLIENT_ID });
    expect(ctx.combined).toContain(INSIGHTS_MARKER);
    expect(ctx.combined).toContain('[BUSINESS]');
    expect(ctx.combined).toContain('[CUSTOMERS]');
    expect(ctx.combined).toContain('[BRIDGE]');
    expect(ctx.combined).toContain('מעקב אישי יומי');
    expect(ctx.combined).toContain('אין זמן להתאמן');
    expect(supabase._tablesSeen).not.toContain('meta_clients');
  });
});
