import { describe, expect, it } from 'vitest';
import {
  DOMAIN_DECISION_MULTIPLIER,
  beliefMovement,
  costToFloor,
  decisionWeight,
  infoValue,
} from '../info-value';
import { UNIT_COSTS, atom, candidate } from './fixtures';

describe('beliefMovement — Bernoulli-belief variance, normalized', () => {
  it('a maximally contested atom (confidence 0.5) scores exactly 1.0', () => {
    // 4·c·(1−c) at c=0.5 → 4·0.25 = 1.0: maximum uncertainty = maximum information.
    expect(beliefMovement([atom({ confidence: 0.5 })])).toBe(1);
  });

  it('a settled atom (confidence 0.9) scores 0.36', () => {
    // 4·0.9·0.1 = 0.36 — a verdict barely moves a near-settled belief.
    expect(beliefMovement([atom({ confidence: 0.9 })])).toBeCloseTo(0.36, 10);
  });

  it('near-certain beliefs (0.05 / 0.95) score near zero', () => {
    expect(beliefMovement([atom({ confidence: 0.05 })])).toBeCloseTo(0.19, 10);
    expect(beliefMovement([atom({ confidence: 0.95 })])).toBeCloseTo(0.19, 10);
  });

  it('averages over the candidate atoms', () => {
    // (1.0 + 0.36) / 2 = 0.68
    const atoms = [atom({ confidence: 0.5 }), atom({ confidence: 0.9 })];
    expect(beliefMovement(atoms)).toBeCloseTo(0.68, 10);
  });

  it('empty atoms → 0 (no visible belief = no measurable movement)', () => {
    expect(beliefMovement([])).toBe(0);
  });

  it('non-finite confidences are treated as absent, never as NaN', () => {
    const broken = atom({ confidence: Number.NaN });
    expect(beliefMovement([broken])).toBe(0);
    expect(beliefMovement([broken, atom({ confidence: 0.5 })])).toBe(1);
  });
});

describe('decisionWeight — atoms moved × domain multiplier', () => {
  it('mirrors lib/attention: max(1, insight_ids) × multiplier', () => {
    expect(decisionWeight({ insight_ids: ['a', 'b', 'c'], domain: 'angle' })).toBe(4.5);
    expect(decisionWeight({ insight_ids: ['a'], domain: 'creative' })).toBe(1);
    expect(decisionWeight({ insight_ids: [], domain: 'funnel' })).toBe(1); // floor: a verdict is itself a decision
  });

  it('strategy-core domains carry the deliberate 1.5× (same constants as lib/attention)', () => {
    expect(DOMAIN_DECISION_MULTIPLIER.angle).toBe(1.5);
    expect(DOMAIN_DECISION_MULTIPLIER.audience).toBe(1.5);
    expect(DOMAIN_DECISION_MULTIPLIER.offer).toBe(1.5);
    expect(DOMAIN_DECISION_MULTIPLIER.creative).toBe(1);
    expect(DOMAIN_DECISION_MULTIPLIER.other).toBe(1);
  });
});

describe('costToFloor — the resolvability math, inverted', () => {
  it('projects an impressions floor through CPM per 1,000', () => {
    // 1000 impressions/arm at ₪20 CPM → ₪20/arm; 2 arms → ₪40 total.
    const result = costToFloor({ metric_grade: 'ctr', per_arm: { impressions: 1000 } }, UNIT_COSTS, 2);
    expect(result).toEqual({ ok: true, per_arm_ils: 20, total_ils: 40, binding_field: 'impressions' });
  });

  it('projects a clicks floor through CPC', () => {
    // 100 clicks/arm at ₪1.5 → ₪150/arm; 2 arms → ₪300.
    const result = costToFloor({ metric_grade: 'cvr', per_arm: { clicks: 100 } }, UNIT_COSTS, 2);
    expect(result).toEqual({ ok: true, per_arm_ils: 150, total_ils: 300, binding_field: 'clicks' });
  });

  it('the BINDING (most expensive) floor sets the cost — spend produces all quantities concurrently', () => {
    const result = costToFloor(
      { metric_grade: 'cvr', per_arm: { impressions: 1000, clicks: 100 } },
      UNIT_COSTS,
      1,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.binding_field).toBe('clicks'); // ₪150 > ₪20
      expect(result.per_arm_ils).toBe(150);
    }
  });

  it('a floor whose unit cost is missing is an explicit failure, not a guess', () => {
    const result = costToFloor({ metric_grade: 'lead_quality', per_arm: { marked_leads: 15 } }, UNIT_COSTS, 2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('expected_cost_per_marked_lead');
  });

  it('a floorless spec has no defined cost', () => {
    const result = costToFloor({ metric_grade: 'ctr', per_arm: {} }, UNIT_COSTS, 2);
    expect(result.ok).toBe(false);
  });
});

describe('infoValue — information per shekel ordering', () => {
  it('a cheap contested-atom candidate outranks an expensive settled-atom one', () => {
    // CHEAP+CONTESTED: 1 atom at c=0.5 (bm=1.0), creative (dw=1),
    //   CTR floor 1000 imp/arm × 2 arms at ₪20 CPM → ₪40.
    //   iv = (1 × 1.0) / max(1, 40) = 0.025
    const contested = candidate({
      id: 'cheap-contested',
      insight_ids: ['c1'],
      domain: 'creative',
      floor_spec: { metric_grade: 'ctr', per_arm: { impressions: 1000 } },
    });
    // EXPENSIVE+SETTLED: 2 atoms at c=0.9 (bm=0.36), angle (dw = 2×1.5 = 3),
    //   CVR floor 100 clicks/arm × 2 arms at ₪1.5 CPC → ₪300.
    //   iv = (3 × 0.36) / 300 = 0.0036 — even with 3× the decision weight,
    //   settled atoms over an expensive floor lose to a cheap contested read.
    const settled = candidate({
      id: 'expensive-settled',
      insight_ids: ['s1', 's2'],
      domain: 'angle',
      floor_spec: { metric_grade: 'cvr', per_arm: { clicks: 100 } },
    });
    const insights = [
      atom({ id: 'c1', confidence: 0.5 }),
      atom({ id: 's1', confidence: 0.9 }),
      atom({ id: 's2', confidence: 0.9 }),
    ];

    const a = infoValue(contested, insights, UNIT_COSTS);
    const b = infoValue(settled, insights, UNIT_COSTS);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.breakdown.info_value).toBeCloseTo(0.025, 4);
      expect(b.breakdown.info_value).toBeCloseTo(0.0036, 4);
      expect(a.breakdown.info_value).toBeGreaterThan(b.breakdown.info_value);
    }
  });

  it('atoms not in the insight pool contribute no belief movement', () => {
    const c = candidate({ insight_ids: ['missing-atom'] });
    const result = infoValue(c, [atom({ id: 'other', confidence: 0.5 })], UNIT_COSTS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.breakdown.belief_movement).toBe(0);
      expect(result.breakdown.info_value).toBe(0);
    }
  });

  it('an unprojectable floor makes the candidate unscoreable, with the reason', () => {
    const c = candidate({ floor_spec: { metric_grade: 'lead_quality', per_arm: { marked_leads: 15 } } });
    const result = infoValue(c, [], UNIT_COSTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('cannot be projected');
  });

  it('total math: every breakdown field is finite (never NaN)', () => {
    const c = candidate({ insight_ids: [] });
    const result = infoValue(c, [], UNIT_COSTS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const v of Object.values(result.breakdown)) expect(Number.isFinite(v)).toBe(true);
    }
  });
});
