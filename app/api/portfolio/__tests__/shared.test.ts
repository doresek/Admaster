// Pure-helper tests for the portfolio assembly layer (D-2 §2):
//   • lane derivation — every threshold exercised at and around its boundary;
//   • top-issue selection — weighted argmax + verbatim reason passthrough;
//   • aggregate math — sums, delta honesty (prev 0/null → null), lane counts;
//   • ranking passthrough — rankClients order preserved, never re-sorted;
//   • owner boundary — a ranked id outside the owner's client map is dropped;
//   • narration assembly — ANTI-HALLUCINATION: every numeric token in the
//     narration traces to the computed aggregates (the digest whitelist-scan
//     pattern, applied at portfolio level).

import { describe, expect, it } from 'vitest';
import type { AttentionComponents, AttentionScore } from '@/lib/attention';
import { periodDaysInclusive, type MetricValue } from '@/lib/metrics-layer';
import {
  buildAggregates,
  buildPortfolioPayload,
  buildSummaries,
  COMPONENT_LABEL_HE,
  currentWeekPeriod,
  deltaPct,
  deriveLane,
  headlineMetric,
  LANE_ANOMALY_URGENT,
  LANE_BADNESS_URGENT,
  LANE_BADNESS_WATCH,
  LANE_ERROR_URGENT,
  LANE_SCORE_WATCH,
  metricBadness,
  portfolioHeadline,
  portfolioMetricFacts,
  topIssue,
  worstBadness,
  type PortfolioAggregates,
} from '../shared';

// ── fixtures ──────────────────────────────────────────────────────────────────

type ComponentKey = keyof AttentionComponents;
type ComponentValues = Partial<Record<ComponentKey, number>>;

/** AttentionScore with the given component values; reasons are per-component markers. */
function makeScore(clientId: string, c: ComponentValues = {}, total = 0): AttentionScore {
  const comp = (key: ComponentKey) => ({ value: c[key] ?? 0, reason: `${key}-reason` });
  return {
    clientId,
    score: total,
    components: {
      anomaly:         comp('anomaly'),
      hypothesisValue: comp('hypothesisValue'),
      staleness:       comp('staleness'),
      calendar:        comp('calendar'),
      errors:          comp('errors'),
    },
  };
}

function makeMetric(over: Partial<MetricValue> & { key: MetricValue['key'] }): MetricValue {
  return {
    name_he:               'מדד',
    unit:                  'count',
    direction:             'up_good',
    honesty_label:         null,
    value:                 null,
    not_computable_reason: null,
    prev:                  null,
    delta_pct:             null,
    vs_goal:               null,
    vs_benchmark:          null,
    ...over,
  };
}

const leads = (value: number | null, prev: number | null = null, delta: number | null = null) =>
  makeMetric({ key: 'leads_total', name_he: 'לידים', value, prev, delta_pct: delta });

const spend = (value: number | null) =>
  makeMetric({
    key: 'spend_total', name_he: 'השקעה בפרסום', unit: 'ils', direction: 'down_good',
    honesty_label: 'תקציב מתוכנן — לא הוצאה בפועל מהפלטפורמה', value,
  });

// ── lane derivation — thresholds at and around every boundary ────────────────

describe('deriveLane', () => {
  it('errors ≥ 0.85 → urgent; just below (with no other signal) → watch', () => {
    expect(deriveLane(makeScore('c', { errors: LANE_ERROR_URGENT }), null)).toBe('urgent');
    expect(deriveLane(makeScore('c', { errors: 0.84 }), null)).toBe('watch'); // any error ⇒ at least watch
  });

  it('anomaly ≥ 0.5 → urgent; a fresh-low-severity anomaly (~0.39) → watch', () => {
    expect(deriveLane(makeScore('c', { anomaly: LANE_ANOMALY_URGENT }), null)).toBe('urgent');
    expect(deriveLane(makeScore('c', { anomaly: 0.49 }), null)).toBe('watch');
    expect(deriveLane(makeScore('c', { anomaly: 0.39 }), null)).toBe('watch');
  });

  it('a metric moving ≥50% the WRONG way → urgent (both directions)', () => {
    // up_good falling 50% (leads halved):
    expect(deriveLane(makeScore('c'), [leads(5, 10, -LANE_BADNESS_URGENT)])).toBe('urgent');
    // down_good rising 50% (cost per lead up):
    const cpl = makeMetric({ key: 'cost_per_lead', unit: 'ils', direction: 'down_good', value: 30, prev: 20, delta_pct: 50 });
    expect(deriveLane(makeScore('c'), [cpl])).toBe('urgent');
  });

  it('wrong-way move in [20..50) → watch; just under 20 → ok', () => {
    expect(deriveLane(makeScore('c'), [leads(8, 10, -49.9)])).toBe('watch');
    expect(deriveLane(makeScore('c'), [leads(8, 10, -LANE_BADNESS_WATCH)])).toBe('watch');
    expect(deriveLane(makeScore('c'), [leads(9, 10, -19.9)])).toBe('ok');
  });

  it('an IMPROVEMENT is never bad — up_good +80% stays ok', () => {
    expect(deriveLane(makeScore('c'), [leads(18, 10, 80)])).toBe('ok');
  });

  it('composite score ≥ 0.30 → watch; below → ok', () => {
    expect(deriveLane(makeScore('c', {}, LANE_SCORE_WATCH), null)).toBe('watch');
    expect(deriveLane(makeScore('c', {}, 0.29), null)).toBe('ok');
  });

  it('a never-analyzed client (staleness alone, score 0.12) is ok — new, not troubled', () => {
    expect(deriveLane(makeScore('c', { staleness: 1 }, 0.12), null)).toBe('ok');
  });

  it('null metrics (partial/beyond cap) → laned from attention alone', () => {
    expect(deriveLane(makeScore('c'), null)).toBe('ok');
    expect(deriveLane(makeScore('c', { errors: 1 }), null)).toBe('urgent');
  });
});

describe('metricBadness / worstBadness', () => {
  it('direction-adjusts the sign: wrong-way is positive', () => {
    expect(metricBadness(leads(5, 10, -50))).toBe(50);
    expect(metricBadness(leads(15, 10, 50))).toBe(-50);
    const down = makeMetric({ key: 'cost_per_lead', direction: 'down_good', delta_pct: 30 });
    expect(metricBadness(down)).toBe(30);
  });

  it('null delta contributes 0; empty/null lists → 0; picks the worst', () => {
    expect(metricBadness(leads(5))).toBe(0);
    expect(worstBadness(null)).toBe(0);
    expect(worstBadness([])).toBe(0);
    expect(worstBadness([leads(5, 10, -50), leads(9, 10, -10), leads(null)])).toBe(50);
  });
});

// ── deltaPct — the metrics layer's honesty rule, mirrored + tested ───────────

describe('deltaPct', () => {
  it('null when either side is missing or prev is 0 (change-from-zero is "new", not +∞%)', () => {
    expect(deltaPct(null, 10)).toBeNull();
    expect(deltaPct(10, null)).toBeNull();
    expect(deltaPct(10, 0)).toBeNull();
  });

  it('1-dp rounding, both directions', () => {
    expect(deltaPct(5, 4)).toBe(25);
    expect(deltaPct(1, 3)).toBe(-66.7);
  });
});

// ── top issue — weighted argmax + verbatim reason ────────────────────────────

describe('topIssue', () => {
  it('all-zero components → null (no open issue)', () => {
    expect(topIssue(makeScore('c'))).toBeNull();
  });

  it('picks by WEIGHTED contribution (scoreAttention arithmetic), not raw value', () => {
    // errors 1.0 × 0.25 = 0.25 beats staleness 1.0 × 0.12.
    const a = topIssue(makeScore('c', { errors: 1, staleness: 1 }));
    expect(a?.component).toBe('errors');
    expect(a?.label_he).toBe(COMPONENT_LABEL_HE.errors);
    // anomaly 0.8 × 0.35 = 0.28 beats errors 1.0 × 0.25.
    const b = topIssue(makeScore('c', { anomaly: 0.8, errors: 1 }));
    expect(b?.component).toBe('anomaly');
    // staleness 1.0 × 0.12 beats calendar 1.0 × 0.08.
    const c = topIssue(makeScore('c', { staleness: 1, calendar: 1 }));
    expect(c?.component).toBe('staleness');
  });

  it('passes the component reason through VERBATIM (the C-06 audit text)', () => {
    const issue = topIssue(makeScore('c', { errors: 0.9 }));
    expect(issue?.reason).toBe('errors-reason');
  });
});

// ── headline metric extraction ────────────────────────────────────────────────

describe('headlineMetric', () => {
  it('extracts leads_total value + delta; absent metric → nulls', () => {
    expect(headlineMetric([leads(12, 8, 50)])).toEqual({ leads: 12, delta_pct: 50 });
    expect(headlineMetric([spend(70)])).toEqual({ leads: null, delta_pct: null });
  });
});

// ── summaries — ranking passthrough + owner boundary + partial marking ───────

describe('buildSummaries', () => {
  const names = new Map([['c-b', 'לקוח ב'], ['c-a', 'לקוח א'], ['c-c', 'לקוח ג']]);

  it('preserves the rankClients order exactly (the triage order is never re-sorted)', () => {
    const ranked = [makeScore('c-c'), makeScore('c-a'), makeScore('c-b')];
    const out = buildSummaries({ ranked, names, metricsByClient: new Map() });
    expect(out.map((s) => s.clientId)).toEqual(['c-c', 'c-a', 'c-b']);
  });

  it('DROPS a ranked id that is not in the owner client map (foreign client never appears)', () => {
    const ranked = [makeScore('c-a'), makeScore('foreign-1'), makeScore('c-b')];
    const out = buildSummaries({ ranked, names, metricsByClient: new Map() });
    expect(out.map((s) => s.clientId)).toEqual(['c-a', 'c-b']);
    expect(JSON.stringify(out)).not.toContain('foreign-1');
  });

  it('marks clients without computed metrics as partial (headline_metric null)', () => {
    const metricsByClient = new Map<string, readonly MetricValue[]>([['c-a', [leads(7, 5, 40)]]]);
    const out = buildSummaries({ ranked: [makeScore('c-a'), makeScore('c-b')], names, metricsByClient });
    expect(out[0]).toMatchObject({ partial: false, headline_metric: { leads: 7, delta_pct: 40 } });
    expect(out[1]).toMatchObject({ partial: true, headline_metric: null });
  });
});

// ── aggregate math ────────────────────────────────────────────────────────────

describe('buildAggregates', () => {
  const names = new Map([['c-1', 'א'], ['c-2', 'ב'], ['c-3', 'ג']]);
  const metricsByClient = new Map<string, readonly MetricValue[]>([
    ['c-1', [leads(12, 10, 20), spend(70)]],
    ['c-2', [leads(5, 10, -50), spend(140)]],
    // c-3 has NO computed metrics.
  ]);
  const summaries = buildSummaries({
    ranked: [makeScore('c-1'), makeScore('c-2', { errors: 1 }), makeScore('c-3')],
    names,
    metricsByClient,
  });

  it('sums leads/prev/spend over computed clients; delta from the summed pair', () => {
    const agg = buildAggregates(summaries, metricsByClient, false);
    expect(agg.leads_total).toBe(17);      // 12 + 5
    expect(agg.leads_prev).toBe(20);       // 10 + 10
    expect(agg.leads_delta_pct).toBe(-15); // (17-20)/20
    expect(agg.spend_total).toBe(210);     // 70 + 140
    expect(agg.computed_clients).toBe(2);
    expect(agg.clients_total).toBe(3);
  });

  it('counts lanes from the derived summaries', () => {
    const agg = buildAggregates(summaries, metricsByClient, false);
    // c-2: errors 1.0 → urgent AND leads -50% → urgent anyway; c-1, c-3 → ok.
    expect(agg.lane_counts).toEqual({ urgent: 1, watch: 0, ok: 2 });
  });

  it('spend honesty label comes from THE registry (planned budget until H4)', () => {
    const agg = buildAggregates(summaries, metricsByClient, false);
    expect(agg.spend_honesty_label).toBe('תקציב מתוכנן — לא הוצאה בפועל מהפלטפורמה');
  });

  it('no computed metrics → null totals (never a fabricated 0)', () => {
    const agg = buildAggregates(summaries, new Map(), true);
    expect(agg.leads_total).toBeNull();
    expect(agg.spend_total).toBeNull();
    expect(agg.leads_delta_pct).toBeNull();
    expect(agg.metrics_capped).toBe(true);
  });
});

// ── narration facts + headline ────────────────────────────────────────────────

const AGG: PortfolioAggregates = {
  clients_total:       4,
  lane_counts:         { urgent: 1, watch: 2, ok: 1 },
  leads_total:         17,
  leads_prev:          20,
  leads_delta_pct:     -15,
  spend_total:         210,
  spend_honesty_label: 'תקציב מתוכנן — לא הוצאה בפועל מהפלטפורמה',
  computed_clients:    3,
  metrics_capped:      false,
};

describe('portfolioMetricFacts', () => {
  it('dresses the sums in the registry identity, honesty label preserved', () => {
    const facts = portfolioMetricFacts(AGG);
    const leadsFact = facts.find((f) => f.key === 'leads_total');
    const spendFact = facts.find((f) => f.key === 'spend_total');
    expect(leadsFact).toMatchObject({ value: 17, prev: 20, delta_pct: -15, name_he: 'לידים' });
    expect(spendFact).toMatchObject({
      value: 210,
      honesty_label: 'תקציב מתוכנן — לא הוצאה בפועל מהפלטפורמה',
      prev: null, // prev-period spend is honestly unknown pre-H4
    });
  });

  it('null aggregates → null values WITH Hebrew reasons (never invented numbers)', () => {
    const facts = portfolioMetricFacts({ ...AGG, leads_total: null, leads_prev: null, leads_delta_pct: null, spend_total: null });
    for (const f of facts) {
      expect(f.value).toBeNull();
      expect(f.not_computable_reason).not.toBeNull();
    }
  });
});

describe('portfolioHeadline', () => {
  it('zero clients → the honest empty line', () => {
    expect(portfolioHeadline({ ...AGG, clients_total: 0 }, null)).toBe('אין עדיין לקוחות בתיק.');
  });

  it('singular agreement for one client', () => {
    const line = portfolioHeadline({ ...AGG, clients_total: 1 }, null);
    expect(line).toContain('לקוח אחד');
  });

  it('lane counts + the most-urgent clause (name + fixed component label)', () => {
    const line = portfolioHeadline(AGG, {
      clientId: 'c-2', name: 'מרפאת שיניים כהן', attention_score: 0.4, lane: 'urgent',
      headline_metric: null, partial: true,
      top_issue: { component: 'errors', label_he: COMPONENT_LABEL_HE.errors, reason: 'connection error' },
    });
    expect(line).toContain('4 לקוחות');
    expect(line).toContain('דחוף: 1');
    expect(line).toContain('לתשומת לב: 2');
    expect(line).toContain('תקין: 1');
    expect(line).toContain('הכי דחוף: מרפאת שיניים כהן — תקלה בצינור הנתונים.');
  });
});

// ── full payload: lanes group in rank order + anti-hallucination scan ────────

describe('buildPortfolioPayload', () => {
  const period = { start: '2026-06-30', end: '2026-07-06' };
  const names = new Map([['c-1', 'אלפא'], ['c-2', 'בטא'], ['c-3', 'גמא'], ['c-4', 'דלתא']]);
  const metricsByClient = new Map<string, readonly MetricValue[]>([
    ['c-2', [leads(12, 10, 20), spend(70)]],
    ['c-1', [leads(5, 10, -50), spend(140)]],
    ['c-3', [leads(3, 3, 0)]],
  ]);
  // Rank order (as rankClients would emit): urgent-by-error first, then others.
  const ranked = [
    makeScore('c-2', { errors: 1 }, 0.25),          // urgent (errors ≥ .85)
    makeScore('c-1', {}, 0.1),                      // urgent (leads −50%)
    makeScore('c-3', { anomaly: 0.3 }, 0.105),      // watch (anomaly > 0)
    makeScore('c-4', {}, 0),                        // ok, partial (no metrics)
  ];

  const payload = buildPortfolioPayload({ ranked, names, metricsByClient, period, metricsCapped: false, warnings: [] });

  it('groups lanes preserving the rank order within each lane', () => {
    expect(payload.lanes.urgent.map((s) => s.clientId)).toEqual(['c-2', 'c-1']);
    expect(payload.lanes.watch.map((s) => s.clientId)).toEqual(['c-3']);
    expect(payload.lanes.ok.map((s) => s.clientId)).toEqual(['c-4']);
  });

  it('narration sources are the aggregate metric facts', () => {
    expect(payload.narration.sources).toEqual(['metric:leads_total', 'metric:spend_total']);
  });

  it('ANTI-HALLUCINATION: every numeric token in the narration traces to computed values', () => {
    const numericTokens = (s: string): string[] =>
      [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
    // The whitelist is the COMPUTED aggregates + the period — the only numbers
    // the narration may contain (discipline: numbers only from computed values).
    const whitelist = new Set(numericTokens(JSON.stringify({ agg: payload.aggregates, period })));
    expect(whitelist.size).toBeGreaterThan(0);
    // Skip the narration's first line: the period header re-orders the same
    // date ('2026-06-30' → '30.06.2026'), same as the engine's own tests.
    const body = payload.narration.text_he.split('\n').slice(1).join('\n');
    const scanned = [...numericTokens(payload.narration.headline_he), ...numericTokens(body)];
    expect(scanned.length).toBeGreaterThan(0);
    for (const n of scanned) {
      expect(whitelist.has(n), `rendered ${n} is not a computed value`).toBe(true);
    }
  });

  it('renders the spend honesty label inside the narration text', () => {
    expect(payload.narration.text_he).toContain('תקציב מתוכנן');
  });
});

// ── period helper ─────────────────────────────────────────────────────────────

describe('currentWeekPeriod', () => {
  it('7-day inclusive UTC window ending today', () => {
    const p = currentWeekPeriod(new Date('2026-07-06T15:30:00Z'));
    expect(p).toEqual({ start: '2026-06-30', end: '2026-07-06' });
    expect(periodDaysInclusive(p)).toBe(7);
  });

  it('crosses month boundaries correctly', () => {
    expect(currentWeekPeriod(new Date('2026-07-03T01:00:00Z')))
      .toEqual({ start: '2026-06-27', end: '2026-07-03' });
  });
});
