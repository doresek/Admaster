// Tests for the decision→hypothesis bridge (from-decision.ts): every executed
// MarketingDecision becomes a pre-registered, falsifiable bet about EXACTLY
// the atoms that grounded it — frozen before launch.
import { describe, expect, it } from 'vitest';
import type { MarketingDecision } from '@/lib/decision-engine/types';
import {
  CAMPAIGN_ARM,
  DEFAULT_DECISION_CONFIDENCE,
  DEFAULT_METRIC_FLOOR,
  REFUTED_WEIGHT,
  SUPPORTED_WEIGHT,
  hypothesisFromDecision,
  metricForObjective,
} from '../from-decision';
import { validateRegistration } from '../core';

const decision = (over: Partial<MarketingDecision> = {}): MarketingDecision => ({
  angle: 'ביטחון רגשי — לא עוד טיפול, שקט נפשי',
  sub_audience: 'נשים 35-50 שדוחות טיפול מפחד',
  targeting_spec: { geo: 'IL', age_min: 35, age_max: 50, genders: 'female', interests: [] },
  platform: 'facebook',
  placement: ['feed'],
  objective: 'leads',
  funnel_stage: 'MOFU',
  daily_budget: 80,
  grounded_in: ['atom-angle', 'atom-desire', 'atom-objection'],
  rationale: 'הזווית נשענת על תובנת הביטחון (0.85)',
  ...over,
});

describe('metricForObjective', () => {
  it('grades conversion-type objectives as cvr with a clicks floor', () => {
    for (const objective of ['leads', 'conversions', 'messages']) {
      const m = metricForObjective(objective);
      expect(m.metric).toBe('cvr');
      expect(m.floor.per_arm.clicks).toBe(100);
    }
  });

  it('grades reach-type (and unknown) objectives as ctr with an impressions floor', () => {
    for (const objective of ['awareness', 'traffic', 'engagement', 'something_new']) {
      const m = metricForObjective(objective);
      expect(m.metric).toBe('ctr');
      expect(m.floor.per_arm.impressions).toBe(1000);
    }
  });
});

describe('hypothesisFromDecision', () => {
  it('states the bet over exactly the grounding atoms, criteria frozen', () => {
    const input = hypothesisFromDecision({
      clientId: 'c1', ownerUserId: 'o1', decision: decision(), campaignItemId: 'item-9',
    });
    expect(input).not.toBeNull();
    if (input === null) throw new Error('unreachable');

    expect(input.insightIds).toEqual(['atom-angle', 'atom-desire', 'atom-objection']);
    expect(input.domain).toBe('angle');
    expect(input.claim).toContain('ביטחון רגשי');
    expect(input.claim).toContain('נשים 35-50');

    // prediction: single campaign arm vs the honest prior for the metric grade
    expect(input.prediction).toEqual({
      metric: 'cvr', comparator: 'gte', value: DEFAULT_METRIC_FLOOR.cvr,
      arm: CAMPAIGN_ARM, confidence: DEFAULT_DECISION_CONFIDENCE,
    });

    // verdict map: corroborate 0.4 / weaken 0.3 on the SAME atoms, both below
    // the lifecycle's decisive threshold (one campaign never refutes alone)
    expect(input.verdictMap.supported).toEqual(
      input.insightIds.map((id) => ({ insight_id: id, polarity: 'positive', weight: SUPPORTED_WEIGHT })),
    );
    expect(input.verdictMap.refuted).toEqual(
      input.insightIds.map((id) => ({ insight_id: id, polarity: 'negative', weight: REFUTED_WEIGHT })),
    );
    expect(input.verdictMap.inconclusive).toEqual([]);
    expect(SUPPORTED_WEIGHT).toBeLessThan(0.7);
    expect(REFUTED_WEIGHT).toBeLessThan(0.7);

    expect(input.testRefs).toEqual([{ arm_label: CAMPAIGN_ARM, campaign_item_id: 'item-9' }]);
    expect(input.killRules).toEqual({});
  });

  it('produces an input that passes C-01 registration validation as-is', () => {
    const input = hypothesisFromDecision({ clientId: 'c1', ownerUserId: 'o1', decision: decision() });
    if (input === null) throw new Error('unreachable');
    const validation = validateRegistration(input);
    expect(validation.ok).toBe(true);
  });

  it('refuses an ungrounded decision (no atoms → no bet, null)', () => {
    expect(
      hypothesisFromDecision({ clientId: 'c1', ownerUserId: 'o1', decision: decision({ grounded_in: [] }) }),
    ).toBeNull();
  });

  it('omits campaign_item_id when persistence produced none', () => {
    const input = hypothesisFromDecision({ clientId: 'c1', ownerUserId: 'o1', decision: decision() });
    if (input === null) throw new Error('unreachable');
    expect(input.testRefs[0].campaign_item_id).toBeUndefined();
  });
});
