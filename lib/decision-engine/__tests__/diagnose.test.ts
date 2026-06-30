import { describe, it, expect } from 'vitest';
import { diagnoseFailure, DIAGNOSIS_THRESHOLDS, findUnderperformingAvatar } from '../diagnose';
import { atom, sampleInsights } from './fixtures';

describe('diagnoseFailure — data sufficiency', () => {
  it('returns none when impressions are below the minimum', () => {
    const d = diagnoseFailure({ performance: { metrics: { impressions: 100, clicks: 0 } }, insights: [] });
    expect(d.failed_link).toBe('none');
    expect(d.recommended_action.action).toBe('gather_more_data');
    expect(d.target_insight_ids).toEqual([]);
  });
});

describe('diagnoseFailure — hook / creative (high impressions, low CTR)', () => {
  it('blames the HOOK and targets the bridge hook atom when one exists', () => {
    const d = diagnoseFailure({
      performance: { metrics: { impressions: 50000, clicks: 100 } }, // 0.2% CTR
      insights: sampleInsights(),
    });
    expect(d.failed_link).toBe('hook');
    expect(d.target_insight_ids).toContain('hook_1');
    expect(d.recommended_action.action).toBe('rewrite_hook');
    expect(d.rationale).toMatch(/hook/i);
  });

  it('falls back to CREATIVE when there is no hook/angle atom to point at', () => {
    const d = diagnoseFailure({
      performance: { metrics: { impressions: 50000, ctr: 0.002 } },
      insights: [], // no bridge atoms
    });
    expect(d.failed_link).toBe('creative');
    expect(d.recommended_action.action).toBe('redesign_creative');
  });
});

describe('diagnoseFailure — offer vs funnel (good CTR, dead conversions)', () => {
  it('blames the OFFER when an unresolved objection atom is active', () => {
    const d = diagnoseFailure({
      performance: { metrics: { impressions: 20000, clicks: 600, conversions: 1 } }, // CTR 3%, CVR ~0.17%
      insights: sampleInsights(),
    });
    expect(d.failed_link).toBe('offer');
    expect(d.target_insight_ids).toContain('objection_1');
    expect(d.recommended_action.action).toBe('address_objection');
    expect(d.rationale).toMatch(/objection/i);
    expect(d.rationale).toMatch(/creative is fine|offer doesn't answer/i);
  });

  it('blames the FUNNEL when conversions die but no objection atom is active', () => {
    const insights = sampleInsights().filter((a) => a.kind !== 'objection');
    const d = diagnoseFailure({
      performance: { metrics: { impressions: 20000, clicks: 600, conversions: 1 }, },
      insights,
    });
    expect(d.failed_link).toBe('funnel');
    expect(d.target_insight_ids).toEqual([]);
    expect(d.recommended_action.action).toBe('audit_funnel');
  });
});

describe('diagnoseFailure — avatar (one avatar fails across hooks)', () => {
  it('blames the AVATAR and targets the matching persona atom', () => {
    const variants = [
      { avatar: 'busy_moms', hook: 'h1', impressions: 5000, clicks: 10 },   // 0.2%
      { avatar: 'busy_moms', hook: 'h2', impressions: 5000, clicks: 15 },   // 0.3%
      { avatar: 'solopreneurs', hook: 'h1', impressions: 5000, clicks: 150 }, // 3%
      { avatar: 'solopreneurs', hook: 'h2', impressions: 5000, clicks: 160 }, // 3.2%
    ];
    const insights = [
      ...sampleInsights(),
      atom({ id: 'persona_moms', layer: 'customers', kind: 'persona', content: 'busy_moms juggling kids', confidence: 0.7 }),
    ];
    const d = diagnoseFailure({
      performance: { metrics: { impressions: 20000, ctr: 0.012, variants } },
      insights,
    });
    expect(d.failed_link).toBe('avatar');
    expect(d.recommended_action.avatar).toBe('busy_moms');
    expect(d.target_insight_ids).toContain('persona_moms');
  });

  it('findUnderperformingAvatar requires multiple hooks', () => {
    const single = [
      { avatar: 'a', hook: 'h1', impressions: 1000, clicks: 1 },
      { avatar: 'b', hook: 'h1', impressions: 1000, clicks: 100 },
    ];
    expect(findUnderperformingAvatar(single)).toBeUndefined();
  });
});

describe('diagnoseFailure — audience saturation', () => {
  it('blames the AUDIENCE on high frequency with otherwise-healthy metrics', () => {
    const d = diagnoseFailure({
      performance: { metrics: { impressions: 40000, ctr: 0.02, conversion_rate: 0.03, frequency: 5 } },
      insights: sampleInsights(),
    });
    expect(d.failed_link).toBe('audience');
    expect(d.target_insight_ids).toContain('persona_1');
    expect(d.recommended_action.action).toBe('expand_or_refresh_audience');
  });
});

describe('diagnoseFailure — healthy', () => {
  it('returns none when everything is within healthy ranges', () => {
    const d = diagnoseFailure({
      performance: { metrics: { impressions: 30000, ctr: 0.025, conversion_rate: 0.04, frequency: 1.5 } },
      insights: sampleInsights(),
    });
    expect(d.failed_link).toBe('none');
    expect(d.recommended_action.action).toBe('scale_or_hold');
  });

  it('exposes the thresholds it uses', () => {
    expect(DIAGNOSIS_THRESHOLDS.HEALTHY_CTR).toBeGreaterThan(0);
    expect(DIAGNOSIS_THRESHOLDS.MIN_IMPRESSIONS).toBeGreaterThan(0);
  });
});
