import { describe, it, expect } from 'vitest';
import { decide } from '../decide';
import type { MarketingDecision, StrategyAnalysis } from '../types';
import { atom, sampleInsights } from './fixtures';

describe('decide — angle selection', () => {
  it('prefers the highest-confidence bridge angle atom', () => {
    const d = decide({ insights: sampleInsights() });
    expect(d.angle).toBe('From overwhelmed to in-control in 30 days');
    expect(d.grounded_in).toContain('angle_high');
    expect(d.grounded_in).not.toContain('angle_low');
    expect(d.rationale).toMatch(/0\.82/);
  });

  it('falls back to value_translation when no angle atom exists', () => {
    const insights = sampleInsights().filter((a) => a.kind !== 'angle');
    const d = decide({ insights });
    expect(d.angle).toBe('Our system = their freedom');
    expect(d.grounded_in).toContain('vt_1');
  });

  it('falls back to strategy / default when no bridge atoms exist', () => {
    const strategy = { platform_funnel: { ad_format: 'Strategy format angle' } } as unknown as StrategyAnalysis;
    const d = decide({ insights: [], strategy });
    expect(d.angle).toBe('Strategy format angle');
  });
});

describe('decide — sub-audience & targeting from customers atoms', () => {
  it('takes sub-audience from the persona atom', () => {
    const d = decide({ insights: sampleInsights() });
    expect(d.sub_audience).toBe('Female solopreneurs 30-45 drowning in admin');
    expect(d.grounded_in).toContain('persona_1');
  });

  it('derives age/gender from the persona structured blob, geo from constraint', () => {
    const d = decide({ insights: sampleInsights() });
    expect(d.targeting_spec.age_min).toBe(30);
    expect(d.targeting_spec.age_max).toBe(45);
    expect(d.targeting_spec.genders).toBe('female');
    // interests seeded from customers-layer want atoms
    expect(d.targeting_spec.interests.length).toBeGreaterThan(0);
    expect(d.targeting_spec.interests.some((i) => i.includes('weekends') || i.includes('admin'))).toBe(true);
    // lookalike suggested because persona confidence >= 0.6
    expect(d.targeting_spec.lookalike_hint).toBeTruthy();
  });

  it('client default_geo overrides constraint-derived geo', () => {
    const d = decide({ insights: sampleInsights(), client: { default_geo: 'US' } });
    expect(d.targeting_spec.geo).toBe('US');
  });

  it('falls back to pain/desire for sub-audience when no persona', () => {
    const insights = sampleInsights().filter((a) => a.kind !== 'persona');
    const d = decide({ insights });
    expect(d.sub_audience).toBe('No time, working nights'); // pain_1 conf 0.8 > desire 0.72
    expect(d.grounded_in).toContain('pain_1');
  });
});

describe('decide — awareness → funnel/objective', () => {
  const mk = (awareness: string) =>
    decide({ insights: [atom({ id: 'a', layer: 'customers', kind: 'awareness', content: awareness, confidence: 0.7 })] });

  it('maps Solution-aware → MOFU/traffic', () => {
    const d = mk('Solution-aware');
    expect(d.funnel_stage).toBe('MOFU');
    expect(d.objective).toBe('traffic');
    expect(d.grounded_in).toContain('a');
  });

  it('maps Unaware → TOFU/awareness', () => {
    expect(mk('Unaware').funnel_stage).toBe('TOFU');
    expect(mk('Unaware').objective).toBe('awareness');
  });

  it('maps Most-aware → BOFU/sales and Product-aware → BOFU/conversions', () => {
    expect(mk('Most-aware')).toMatchObject({ funnel_stage: 'BOFU', objective: 'sales' });
    expect(mk('Product-aware')).toMatchObject({ funnel_stage: 'BOFU', objective: 'conversions' });
  });

  it('defaults to TOFU/engagement when no awareness atom', () => {
    const d = decide({ insights: [] });
    expect(d.funnel_stage).toBe('TOFU');
    expect(d.objective).toBe('engagement');
  });

  it('warm awareness adds a custom-audience (retargeting) hint', () => {
    const insights = sampleInsights().map((a) =>
      a.kind === 'awareness' ? { ...a, content: 'Product-aware' } : a,
    );
    const d = decide({ insights });
    expect(d.targeting_spec.custom_audience_hint).toBeTruthy();
  });
});

describe('decide — platform & placement', () => {
  it('resolves platform from the bridge platform atom and sets placements', () => {
    const d = decide({ insights: sampleInsights() });
    expect(d.platform).toBe('instagram');
    expect(d.placement).toContain('instagram_reels');
    expect(d.grounded_in).toContain('platform_1');
  });

  it('defaults platform to instagram when unresolved', () => {
    const d = decide({ insights: [] });
    expect(d.platform).toBe('instagram');
  });

  it('detects whatsapp from Hebrew content', () => {
    const d = decide({ insights: [atom({ layer: 'bridge', kind: 'platform', content: 'וואטסאפ לטיפול בלידים', confidence: 0.9 })] });
    expect(d.platform).toBe('whatsapp');
    expect(d.placement).toContain('click_to_whatsapp');
  });
});

describe('decide — budget & grounding integrity', () => {
  it('derives daily budget from a client monthly budget', () => {
    const d = decide({ insights: sampleInsights(), client: { monthly_budget: 3000 } });
    expect(d.daily_budget).toBe(100); // 3000/30
  });

  it('uses a stage base scaled by angle confidence when no client budget', () => {
    const d = decide({ insights: sampleInsights() }); // Solution-aware → MOFU base 60
    expect(d.daily_budget).toBeGreaterThanOrEqual(40);
    expect(typeof d.daily_budget).toBe('number');
  });

  it('records grounded_in ids and a non-empty rationale', () => {
    const d = decide({ insights: sampleInsights() });
    expect(d.grounded_in.length).toBeGreaterThan(0);
    // no duplicate ids
    expect(new Set(d.grounded_in).size).toBe(d.grounded_in.length);
    expect(d.rationale.length).toBeGreaterThan(20);
  });

  it('ignores superseded/refuted atoms when choosing the angle', () => {
    const insights = [
      atom({ id: 'dead', layer: 'bridge', kind: 'angle', content: 'Old refuted angle', confidence: 0.99, status: 'refuted' }),
      atom({ id: 'live', layer: 'bridge', kind: 'angle', content: 'Live angle', confidence: 0.5 }),
    ];
    const d = decide({ insights });
    expect(d.angle).toBe('Live angle');
    expect(d.grounded_in).toContain('live');
    expect(d.grounded_in).not.toContain('dead');
  });

  it('is deterministic and pure (same input → same output)', () => {
    const a = decide({ insights: sampleInsights() });
    const b = decide({ insights: sampleInsights() });
    expect(a).toEqual(b);
  });

  it('handles an empty input without throwing', () => {
    const d: MarketingDecision = decide({ insights: [] });
    expect(d.angle).toBeTruthy();
    expect(d.targeting_spec.geo).toBe('IL');
    expect(d.grounded_in).toEqual([]);
  });

  it('refine hook can post-process but the default path is untouched', () => {
    const base = decide({ insights: sampleInsights() });
    const refined = decide(
      { insights: sampleInsights() },
      { refine: (d) => ({ ...d, daily_budget: 999 }) },
    );
    expect(refined.daily_budget).toBe(999);
    expect(base.daily_budget).not.toBe(999);
  });
});
