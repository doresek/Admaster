// Tests for lib/attention/score.ts — the pure attention-scoring core (C-06).
//
// The headline test at the top is the capability's reason to exist (§8.2.2):
// information value, not size, decides who gets attention.
import { describe, it, expect } from 'vitest';
import type { HypothesisRow } from '@/lib/capability-contracts';
import type { AttentionWeights, ClientAttentionState } from '@/lib/attention/types';
import {
  DEFAULT_WEIGHTS,
  hypothesisProgressBump,
  rankClients,
  scoreAnomalies,
  scoreAttention,
  scoreCalendar,
  scoreErrors,
  scoreHypothesisValue,
  scoreStaleness,
} from '@/lib/attention/score';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeHyp = (over: Partial<HypothesisRow> = {}): HypothesisRow => ({
  id: 'h1', client_id: 'c1', owner_user_id: 'u1',
  insight_ids: ['a1', 'a2', 'a3'],
  claim: 'urgency angle beats status angle for leads',
  prediction: { metric: 'ctr', comparator: 'ratio_gte', value: 1.3, arm: 'A', baseline_arm: 'B', confidence: 0.7 },
  floor_spec: { metric_grade: 'ctr', per_arm: { impressions: 4000 } },
  horizon: { max_days: 14 },
  verdict_map: { supported: [], refuted: [], inconclusive: [] },
  kill_rules: {},
  test_refs: [{ arm_label: 'A' }],
  domain: 'angle', status: 'open', resolution: null,
  registered_at: 't0', resolved_at: null, superseded_by: null,
  created_at: 't0', updated_at: 't0',
  ...over,
});

const quietState = (clientId: string, over: Partial<ClientAttentionState> = {}): ClientAttentionState => ({
  clientId,
  ownerUserId: 'u1',
  anomalyFlags: [],
  openHypotheses: [],
  staleness: { daysSinceLastAtomEvent: 1, cadenceDays: 7 },
  calendar: [],
  errorStates: [],
  activeCampaigns: 0,
  ...over,
});

// ── THE HEADLINE TEST ─────────────────────────────────────────────────────────

describe('rankClients — information value, not revenue (§8.2.2)', () => {
  it('a broken pipe and a near-resolution hypothesis outrank the big quiet client; big quiet ranks LAST', () => {
    // The fleet:
    //   big-quiet   — 5 active campaigns (biggest client), nothing open, fresh atoms.
    //   tiny-hyp    — no campaigns, one open high-decisionWeight 'angle' hypothesis
    //                 at 85% of its sample floor (the cheapest information available).
    //   stale-never — the brain has never touched them (no atom events at all).
    //   token-err   — Meta token expiring: the data pipe is about to die.
    const fleet: ClientAttentionState[] = [
      quietState('big-quiet', { activeCampaigns: 5 }),
      quietState('tiny-hyp', {
        openHypotheses: [{ hypothesis: makeHyp(), sampleProgress: 0.85, decisionWeight: 4.5 }],
      }),
      quietState('stale-never', {
        staleness: { daysSinceLastAtomEvent: null, cadenceDays: 7 },
      }),
      quietState('token-err', {
        errorStates: [{ kind: 'meta_token_expiring', severity: 'high' }],
      }),
    ];

    const ranked = rankClients(fleet).map((r) => r.clientId);

    // Why token-err ranks ABOVE the near-resolution hypothesis: an expiring
    // token starves every future signal (metrics, verdicts, reflexes), so the
    // pipe wins over any single opportunity. The hypothesis is second — the
    // cheapest information in the system. The never-analyzed client is third
    // (pure unknown). The big quiet client is LAST: size buys nothing here.
    expect(ranked).toEqual(['token-err', 'tiny-hyp', 'stale-never', 'big-quiet']);
  });

  it('a fresh high-severity anomaly outranks even the broken pipe', () => {
    const fleet: ClientAttentionState[] = [
      quietState('token-err', { errorStates: [{ kind: 'meta_token_expiring', severity: 'high' }] }),
      quietState('on-fire', { anomalyFlags: [{ kind: 'spend_spike_no_results', severity: 'high', ageHours: 1 }] }),
    ];
    expect(rankClients(fleet).map((r) => r.clientId)).toEqual(['on-fire', 'token-err']);
  });
});

// ── scoreAnomalies ────────────────────────────────────────────────────────────

describe('scoreAnomalies', () => {
  it('is 0 with a reason when there are no flags', () => {
    const c = scoreAnomalies([]);
    expect(c.value).toBe(0);
    expect(c.reason).toBe('no anomaly flags');
  });

  it('a fresh high-severity anomaly scores near the top of the scale', () => {
    const c = scoreAnomalies([{ kind: 'ctr_cliff', severity: 'high', ageHours: 0 }]);
    expect(c.value).toBeGreaterThan(0.8);
    expect(c.reason).toContain('ctr_cliff');
  });

  it('decays with age: fresh > 1 day old > 3 days old', () => {
    const at = (ageHours: number) =>
      scoreAnomalies([{ kind: 'x', severity: 'high', ageHours }]).value;
    expect(at(0)).toBeGreaterThan(at(24));
    expect(at(24)).toBeGreaterThan(at(72));
  });

  it('high severity dominates low severity at equal age', () => {
    const at = (severity: 'low' | 'high') =>
      scoreAnomalies([{ kind: 'x', severity, ageHours: 2 }]).value;
    expect(at('high')).toBeGreaterThan(at('low') * 2);
  });

  it('the reason names the most urgent flag, not the first one', () => {
    const c = scoreAnomalies([
      { kind: 'old_low', severity: 'low', ageHours: 100 },
      { kind: 'fresh_high', severity: 'high', ageHours: 1 },
    ]);
    expect(c.reason).toContain('fresh_high');
  });
});

// ── scoreHypothesisValue ──────────────────────────────────────────────────────

describe('hypothesisProgressBump — peak near the floor', () => {
  it('is low at 0, peaks around 0.85, and is low again past the floor (1.2)', () => {
    expect(hypothesisProgressBump(0)).toBeLessThan(0.01);
    expect(hypothesisProgressBump(0.85)).toBe(1);
    expect(hypothesisProgressBump(1.2)).toBeLessThan(0.1);
    // ordering: near-floor beats both a fresh test and an overshot one
    expect(hypothesisProgressBump(0.85)).toBeGreaterThan(hypothesisProgressBump(1.2));
    expect(hypothesisProgressBump(1.2)).toBeGreaterThan(hypothesisProgressBump(0));
  });

  it('the whole hot zone 0.7–0.95 stays high', () => {
    for (const p of [0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
      expect(hypothesisProgressBump(p)).toBeGreaterThan(0.55);
    }
  });
});

describe('scoreHypothesisValue', () => {
  it('is 0 with a reason when nothing is open', () => {
    const c = scoreHypothesisValue([]);
    expect(c.value).toBe(0);
    expect(c.reason).toBe('no open hypotheses');
  });

  it('near-floor progress beats fresh and overshot at equal weight', () => {
    const at = (sampleProgress: number) =>
      scoreHypothesisValue([{ hypothesis: makeHyp(), sampleProgress, decisionWeight: 3 }]).value;
    expect(at(0.85)).toBeGreaterThan(at(0));
    expect(at(0.85)).toBeGreaterThan(at(1.2));
  });

  it('decisionWeight multiplies: a high-leverage claim outranks a low-leverage one', () => {
    const at = (decisionWeight: number) =>
      scoreHypothesisValue([{ hypothesis: makeHyp(), sampleProgress: 0.85, decisionWeight }]).value;
    expect(at(4.5)).toBeGreaterThan(at(1));
  });

  it('saturates: hoarding open hypotheses cannot push the component past 1', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      hypothesis: makeHyp({ id: `h${i}` }),
      sampleProgress: 0.85,
      decisionWeight: 10,
    }));
    const c = scoreHypothesisValue(many);
    expect(c.value).toBeLessThanOrEqual(1);
    expect(c.value).toBeGreaterThan(0.9);
  });

  it('the reason is auditable prose: domain, % of floor, atoms gated', () => {
    const c = scoreHypothesisValue([
      { hypothesis: makeHyp(), sampleProgress: 0.85, decisionWeight: 4.5 },
    ]);
    expect(c.reason).toContain("'angle'");
    expect(c.reason).toContain('85%');
    expect(c.reason).toContain('3 atoms gated');
  });
});

// ── scoreStaleness ────────────────────────────────────────────────────────────

describe('scoreStaleness', () => {
  it('null lastEvent ("never analyzed") is MAXIMAL staleness — above any merely-old client', () => {
    const never = scoreStaleness({ daysSinceLastAtomEvent: null, cadenceDays: 7 });
    const veryOld = scoreStaleness({ daysSinceLastAtomEvent: 100, cadenceDays: 7 });
    expect(never.value).toBe(1);
    expect(never.reason).toContain('never analyzed');
    expect(never.value).toBeGreaterThan(veryOld.value);
  });

  it('is 0 when fresh (0 days, and anything within cadence)', () => {
    expect(scoreStaleness({ daysSinceLastAtomEvent: 0, cadenceDays: 7 }).value).toBe(0);
    expect(scoreStaleness({ daysSinceLastAtomEvent: 7, cadenceDays: 7 }).value).toBe(0);
  });

  it('grows past cadence: 3× cadence is substantially stale', () => {
    const c = scoreStaleness({ daysSinceLastAtomEvent: 21, cadenceDays: 7 });
    expect(c.value).toBeCloseTo(1 - Math.exp(-2 / 1.5), 5);
    expect(c.value).toBeGreaterThan(0.7);
    expect(c.reason).toContain('21d');
  });

  it('is monotone in days-since past the cadence', () => {
    const at = (d: number) => scoreStaleness({ daysSinceLastAtomEvent: d, cadenceDays: 7 }).value;
    expect(at(30)).toBeGreaterThan(at(14));
    expect(at(14)).toBeGreaterThan(at(8));
  });

  it('survives a nonsensical cadence by falling back to the default', () => {
    for (const cadenceDays of [0, -3, NaN, Infinity]) {
      const c = scoreStaleness({ daysSinceLastAtomEvent: 21, cadenceDays });
      expect(Number.isFinite(c.value)).toBe(true);
      expect(c.value).toBeGreaterThan(0); // 21d vs the 7d default cadence
    }
  });
});

// ── scoreCalendar ─────────────────────────────────────────────────────────────

describe('scoreCalendar — act at the DECISION window, not the event window', () => {
  const win = (daysUntilWindow: number, decisionLagDays: number, relevanceConfidence = 1) => ({
    windowLabel: 'wedding season', daysUntilWindow, decisionLagDays, relevanceConfidence,
  });

  it('is 0 with a reason when no windows are ahead', () => {
    const c = scoreCalendar([]);
    expect(c.value).toBe(0);
    expect(c.reason).toBe('no seasonality windows ahead');
  });

  it('THE decision-lag case: event in 30 days with a 45-day lag is URGENT NOW', () => {
    // Customers decided 15 days ago — every further day of delay burns the
    // remaining runway. This must score HIGH, and far above the same event
    // with no decision lag (which is genuinely "in 30 days").
    const late = scoreCalendar([win(30, 45)]);
    const noLag = scoreCalendar([win(30, 0)]);
    expect(late.value).toBeGreaterThan(0.5);
    expect(late.value).toBeGreaterThan(noLag.value * 3);
    expect(late.reason).toContain('act immediately');
  });

  it('peaks exactly at the decision point and rises toward it from above', () => {
    const far = scoreCalendar([win(90, 45)]).value;      // decision in 45d
    const near = scoreCalendar([win(52, 45)]).value;     // decision in 7d
    const atPoint = scoreCalendar([win(45, 45)]).value;  // decision NOW
    expect(atPoint).toBe(1);
    expect(near).toBeGreaterThan(far);
    expect(atPoint).toBeGreaterThan(near);
  });

  it('decays after the decision point passes — the opportunity is fading', () => {
    const justLate = scoreCalendar([win(30, 45)]).value;  // 15d past decision
    const veryLate = scoreCalendar([win(5, 45)]).value;   // 40d past decision
    expect(justLate).toBeGreaterThan(veryLate);
    expect(veryLate).toBeGreaterThan(0); // still ahead of the event → still actionable
  });

  it('weights by the seasonality atom confidence', () => {
    const sure = scoreCalendar([win(45, 45, 0.9)]).value;
    const shaky = scoreCalendar([win(45, 45, 0.3)]).value;
    expect(sure).toBeCloseTo(0.9, 5);
    expect(shaky).toBeCloseTo(0.3, 5);
  });

  it('takes the MAX across windows, and the reason names the winning window', () => {
    const c = scoreCalendar([
      { windowLabel: 'distant chag', daysUntilWindow: 200, decisionLagDays: 0, relevanceConfidence: 1 },
      { windowLabel: 'pre-Pesach', daysUntilWindow: 10, decisionLagDays: 10, relevanceConfidence: 1 },
    ]);
    expect(c.value).toBe(1);
    expect(c.reason).toContain('pre-Pesach');
  });
});

// ── scoreErrors ───────────────────────────────────────────────────────────────

describe('scoreErrors', () => {
  it('is 0 with a reason when there are no error states', () => {
    const c = scoreErrors([]);
    expect(c.value).toBe(0);
    expect(c.reason).toBe('no error states');
  });

  it('an expiring Meta token is maximal fixed urgency regardless of severity', () => {
    const c = scoreErrors([{ kind: 'meta_token_expiring', severity: 'low' }]);
    expect(c.value).toBe(1);
    expect(c.reason).toContain('Meta token expiring');
  });

  it('connection errors are nearly as urgent; "other" defers to severity', () => {
    expect(scoreErrors([{ kind: 'connection_error', severity: 'med' }]).value).toBeCloseTo(0.85, 5);
    expect(scoreErrors([{ kind: 'other', severity: 'low' }]).value).toBeCloseTo(0.3, 5);
    expect(scoreErrors([{ kind: 'other', severity: 'high' }]).value).toBeCloseTo(0.9, 5);
  });

  it('takes the max across flags (one broken pipe is the problem)', () => {
    const c = scoreErrors([
      { kind: 'other', severity: 'low' },
      { kind: 'meta_token_expiring', severity: 'high' },
    ]);
    expect(c.value).toBe(1);
  });
});

// ── Normalization: totality under extreme inputs ──────────────────────────────

describe('normalization — extreme inputs saturate to [0..1], never NaN/Infinity', () => {
  const EXTREMES = [-1e9, -1, -0.001, 0, 0.5, 1, 3, 1e9, Infinity, -Infinity, NaN];

  it('every component stays finite and within [0..1] over the extreme grid', () => {
    for (const v of EXTREMES) {
      const values = [
        scoreAnomalies([{ kind: 'x', severity: 'high', ageHours: v }]).value,
        scoreHypothesisValue([{ hypothesis: makeHyp(), sampleProgress: v, decisionWeight: v }]).value,
        scoreStaleness({ daysSinceLastAtomEvent: v, cadenceDays: v }).value,
        scoreCalendar([{ windowLabel: 'w', daysUntilWindow: v, decisionLagDays: v, relevanceConfidence: v }]).value,
      ];
      for (const value of values) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('the composite score stays finite even under garbage weights', () => {
    const state = quietState('c1', {
      anomalyFlags: [{ kind: 'x', severity: 'high', ageHours: NaN }],
      openHypotheses: [{ hypothesis: makeHyp(), sampleProgress: Infinity, decisionWeight: NaN }],
      staleness: { daysSinceLastAtomEvent: null, cadenceDays: NaN },
      calendar: [{ windowLabel: 'w', daysUntilWindow: NaN, decisionLagDays: -Infinity, relevanceConfidence: 7 }],
      errorStates: [{ kind: 'other', severity: 'med' }],
    });
    for (const v of EXTREMES) {
      const weights: AttentionWeights = {
        anomaly: v, hypothesisValue: v, staleness: v, calendar: v, errors: v,
      };
      const s = scoreAttention(state, weights);
      expect(Number.isFinite(s.score)).toBe(true);
      expect(s.score).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── Determinism + ranking mechanics ───────────────────────────────────────────

describe('scoreAttention — determinism', () => {
  it('same state → same score, byte for byte (repeat + deep clone)', () => {
    const state = quietState('c1', {
      anomalyFlags: [{ kind: 'ctr_cliff', severity: 'med', ageHours: 5 }],
      openHypotheses: [{ hypothesis: makeHyp(), sampleProgress: 0.8, decisionWeight: 3 }],
      staleness: { daysSinceLastAtomEvent: 12, cadenceDays: 7 },
      calendar: [{ windowLabel: 'w', daysUntilWindow: 20, decisionLagDays: 14, relevanceConfidence: 0.8 }],
      errorStates: [{ kind: 'connection_error', severity: 'high' }],
    });
    const a = scoreAttention(state);
    const b = scoreAttention(state);
    const c = scoreAttention(structuredClone(state));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });

  it('DEFAULT_WEIGHTS sum to exactly 1.0 so the composite stays in [0..1]', () => {
    const sum =
      DEFAULT_WEIGHTS.anomaly + DEFAULT_WEIGHTS.errors + DEFAULT_WEIGHTS.hypothesisValue +
      DEFAULT_WEIGHTS.staleness + DEFAULT_WEIGHTS.calendar;
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

describe('rankClients — mechanics', () => {
  it('equal scores tie-break by clientId ascending, regardless of input order', () => {
    const states = [quietState('c-bbb'), quietState('c-aaa'), quietState('c-ccc')];
    expect(rankClients(states).map((r) => r.clientId)).toEqual(['c-aaa', 'c-bbb', 'c-ccc']);
    expect(rankClients(states.reverse()).map((r) => r.clientId)).toEqual(['c-aaa', 'c-bbb', 'c-ccc']);
  });

  it('topKDetail: everyone gets numbers, only the top K get prose reasons', () => {
    const states = [
      quietState('hot', { errorStates: [{ kind: 'meta_token_expiring', severity: 'high' }] }),
      quietState('warm', { staleness: { daysSinceLastAtomEvent: null, cadenceDays: 7 } }),
      quietState('cold'),
    ];
    const ranked = rankClients(states, { topKDetail: 1 });

    expect(ranked[0].clientId).toBe('hot');
    expect(ranked[0].components.errors.reason).toContain('Meta token');

    for (const r of ranked.slice(1)) {
      expect(r.components.staleness.reason).toBe('');
      expect(r.components.errors.reason).toBe('');
      // ...but the numbers survive for logging/aggregation.
      expect(Number.isFinite(r.components.staleness.value)).toBe(true);
    }
    expect(ranked[1].clientId).toBe('warm');
    expect(ranked[1].components.staleness.value).toBe(1);
  });

  it('empty fleet → empty ranking', () => {
    expect(rankClients([])).toEqual([]);
  });
});
