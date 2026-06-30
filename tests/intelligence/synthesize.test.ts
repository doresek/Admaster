// Tests for lib/intelligence/synthesize.ts — projecting active atoms into the
// StrategyAnalysis (#32) + avatar snapshot and upserting client_strategy.
import { describe, it, expect } from 'vitest';
import { projectSnapshot, synthesizeStrategy } from '@/lib/intelligence/synthesize';
import type { ClientInsight } from '@/lib/intelligence/types';
import { makeFakeDb } from './fake-admin';

const atom = (over: Partial<ClientInsight>): ClientInsight => ({
  id: Math.random().toString(36).slice(2), client_id: 'c1', owner_user_id: 'u1',
  layer: 'business', kind: 'goal', content: '', structured: null,
  source: 'brief', source_ref: null, confidence: 0.5, evidence_count: 1,
  status: 'active', superseded_by: null, superseded_reason: null,
  first_seen_at: 't', updated_at: 't', ...over,
});

const ATOMS: ClientInsight[] = [
  atom({ layer: 'business', kind: 'goal', content: 'לידים לקליניקה', confidence: 0.9 }),
  atom({ layer: 'business', kind: 'real_usp', content: 'מעקב אישי יומי', confidence: 0.85 }),
  atom({ layer: 'business', kind: 'real_usp', content: 'USP חלש יותר', confidence: 0.4 }),
  atom({ layer: 'business', kind: 'constraint', content: 'תקציב מוגבל', confidence: 0.6 }),
  atom({ layer: 'business', kind: 'core_offer', content: 'ליווי 12 שבועות', confidence: 0.8 }),
  atom({ layer: 'customers', kind: 'persona', content: 'אמהות עסוקות', confidence: 0.8 }),
  atom({ layer: 'customers', kind: 'awareness', content: 'Problem-aware', confidence: 0.7 }),
  atom({ layer: 'customers', kind: 'pain', content: 'אין זמן', confidence: 0.9 }),
  atom({ layer: 'customers', kind: 'desire', content: 'להרגיש אנרגטית', confidence: 0.7 }),
  atom({ layer: 'customers', kind: 'objection', content: 'כבר ניסיתי', confidence: 0.6 }),
  atom({ layer: 'bridge', kind: 'platform', content: 'Meta', confidence: 0.8, structured: { rationale: 'הקהל באינסטגרם' } }),
  atom({ layer: 'bridge', kind: 'funnel', content: 'lead-gen', confidence: 0.75, structured: { rationale: 'מחיר גבוה' } }),
  atom({ layer: 'bridge', kind: 'angle', content: 'התחל בלי לשנות הכל', confidence: 0.7 }),
];

describe('projectSnapshot', () => {
  it('projects highest-confidence atoms into the StrategyAnalysis #32 shape', () => {
    const { business_analysis: ba } = projectSnapshot(ATOMS);
    expect(ba.strategic_summary.goal).toBe('לידים לקליניקה');
    expect(ba.strategic_summary.core_offer).toBe('ליווי 12 שבועות');
    expect(ba.strategic_summary.usp).toBe('מעקב אישי יומי'); // prefers higher-confidence USP
    expect(ba.strategic_summary.constraints).toEqual(['תקציב מוגבל']);

    expect(ba.sub_audience.name).toBe('אמהות עסוקות');
    expect(ba.sub_audience.awareness_level).toBe('Problem-aware');
    expect(ba.sub_audience.persona).toBe('אמהות עסוקות');

    expect(ba.platform_funnel.platform).toBe('Meta');
    expect(ba.platform_funnel.funnel_type).toBe('lead-gen');
    expect(ba.platform_funnel.platform_reason).toBe('הקהל באינסטגרם');
    expect(ba.platform_funnel.funnel_reason).toBe('מחיר גבוה');

    expect(ba.offer_stack.components).toContain('ליווי 12 שבועות');
    expect(ba.offer_stack.strengths).toContain('מעקב אישי יומי');
  });

  it('projects the avatar fields buildAiContext renders', () => {
    const { avatar } = projectSnapshot(ATOMS);
    expect(avatar.name).toBe('אמהות עסוקות');
    expect(avatar.pains).toEqual(['אין זמן']);
    expect(avatar.desires).toContain('להרגיש אנרגטית');
    expect(avatar.objections).toEqual(['כבר ניסיתי']);
    expect(avatar.awareness_level).toBe('Problem-aware');
    expect(avatar.recommended_angle).toBe('התחל בלי לשנות הכל');
  });

  it('never leaves offer_stack empty when business atoms exist (falls back across kinds)', () => {
    // Only real_usp / true_value present — no core_offer/real_solution. The
    // offer-stack must still populate components+strengths via the fallback.
    const businessOnly: ClientInsight[] = [
      atom({ layer: 'business', kind: 'real_usp', content: 'מעקב אישי יומי', confidence: 0.85 }),
      atom({ layer: 'business', kind: 'true_value', content: 'חיסכון של שעות', confidence: 0.7 }),
    ];
    const { business_analysis: ba } = projectSnapshot(businessOnly);
    expect(ba.offer_stack.components.length).toBeGreaterThan(0);
    expect(ba.offer_stack.strengths.length).toBeGreaterThan(0);
    expect(ba.offer_stack.assessment).not.toBe('');
  });

  it('empty atom set yields an empty-but-valid snapshot', () => {
    const { business_analysis: ba, avatar } = projectSnapshot([]);
    expect(ba.strategic_summary.goal).toBe('');
    expect(ba.offer_stack.components).toEqual([]);
    expect(avatar.pains).toEqual([]);
  });
});

describe('synthesizeStrategy', () => {
  it('reads active atoms and upserts client_strategy with snapshot + core_generated_at', async () => {
    const db = makeFakeDb({ insights: ATOMS, clients: [{ id: 'c1', owner_user_id: 'u1' }] });
    const out = await synthesizeStrategy(db.admin, 'c1');
    expect(out).not.toBeNull();

    expect(db.client_strategy).toHaveLength(1);
    const row = db.client_strategy[0];
    expect(row.client_id).toBe('c1');
    expect(row.owner_user_id).toBe('u1');
    expect(row.business_analysis.strategic_summary.goal).toBe('לידים לקליניקה');
    expect(row.avatar.pains).toEqual(['אין זמן']);
    expect(row.core_generated_at).toBeTruthy();
  });

  it('resolves owner from clients when there are no atoms, and still upserts', async () => {
    const db = makeFakeDb({ insights: [], clients: [{ id: 'c2', owner_user_id: 'u2' }] });
    const out = await synthesizeStrategy(db.admin, 'c2');
    expect(out).not.toBeNull();
    expect(db.client_strategy[0].owner_user_id).toBe('u2');
  });

  it('returns null when neither atoms nor a client identity resolve an owner', async () => {
    const db = makeFakeDb({ insights: [], clients: [] });
    const out = await synthesizeStrategy(db.admin, 'ghost');
    expect(out).toBeNull();
    expect(db.client_strategy).toHaveLength(0);
  });
});
