// computeMetrics — the TOTALITY + comparison contract:
//   • missing inputs → null values with reasons, NEVER NaN (grid-tested);
//   • NaN-poisoned rows are firewalled at the layer boundary;
//   • delta/goal/benchmark math is hand-verified;
//   • deterministic and shuffle-invariant.

import { describe, expect, it } from 'vitest';
import type { MetricDef, MetricInputs, MetricValue } from '../types';
import { METRIC_REGISTRY } from '../registry';
import { computeMetrics, periodDaysInclusive } from '../compute';
import {
  CURRENT_PERIOD,
  clinicInputs,
  emptyInputs,
  makeCampaign,
  makeEvent,
  makeLead,
} from './fixtures';

const byKey = (values: MetricValue[], key: string): MetricValue => {
  const v = values.find((m) => m.key === key);
  if (v === undefined) throw new Error(`no computed value for ${key}`);
  return v;
};

/** Assert NO numeric field anywhere in the output is NaN/Infinity. */
function expectNoPoison(values: MetricValue[]): void {
  for (const v of values) {
    for (const field of [v.value, v.prev, v.delta_pct, v.vs_goal?.target, v.vs_benchmark?.target]) {
      if (typeof field === 'number') {
        expect(Number.isFinite(field), `${v.key}: non-finite number leaked`).toBe(true);
      }
    }
  }
}

describe('computeMetrics — totality grid', () => {
  it('empty inputs: every metric is an honest 0 or null-with-reason; zero NaN', () => {
    const values = computeMetrics(METRIC_REGISTRY, emptyInputs());
    expect(values).toHaveLength(12);
    expectNoPoison(values);
    for (const v of values) {
      if (v.value === null) {
        expect(v.not_computable_reason, v.key).toBeTruthy();
      } else {
        // counts/sums honestly read 0 on an empty period
        expect([0]).toContain(v.value);
      }
    }
    // spot checks
    expect(byKey(values, 'leads_total').value).toBe(0);
    expect(byKey(values, 'qualified_rate').value).toBeNull();
    expect(byKey(values, 'spend_total').not_computable_reason).toContain('אין קמפיינים חיים');
  });

  it('partial inputs: leads without campaigns/economics → funnel metrics compute, money metrics explain', () => {
    const inputs = emptyInputs();
    inputs.current.leads = [
      makeLead({ id: 'l-1', current_stage: 'qualified', consent_marketing: true }),
      makeLead({ id: 'l-2' }),
    ];
    const values = computeMetrics(METRIC_REGISTRY, inputs);
    expectNoPoison(values);
    expect(byKey(values, 'leads_total').value).toBe(2);
    expect(byKey(values, 'qualified_rate').value).toBe(50);
    expect(byKey(values, 'cost_per_lead').value).toBeNull();
    expect(byKey(values, 'roas_vs_breakeven').not_computable_reason).toContain('חסרים נתוני כלכלה');
  });

  it('NaN-poisoned rows (budget/value NaN, malformed dates) → nulls with reasons, never NaN', () => {
    const inputs = emptyInputs();
    inputs.current.leads = [makeLead({ id: 'l-1', created_at: 'not-a-date' })];
    inputs.current.stageEvents = [
      makeEvent({ id: 'e-1', lead_id: 'l-1', stage: 'closed_won', value: Number.NaN }),
    ];
    inputs.current.campaigns = [makeCampaign({ id: 'c-1', daily_budget: Number.NaN })];
    const values = computeMetrics(METRIC_REGISTRY, inputs);
    expectNoPoison(values);
    expect(byKey(values, 'spend_total').value).toBeNull();          // NaN budget filtered → no live spend
    expect(byKey(values, 'closed_value').not_computable_reason).toContain('בלי ערך רשום'); // NaN value ≠ recorded value
    expect(byKey(values, 'contacted_24h_rate').value).toBe(0);      // unparseable date = not answered, not NaN
  });

  it('a throwing formula is captured as null-with-reason (surfaced, not swallowed; never a throw)', () => {
    const bomb: MetricDef = {
      key:            'leads_total',
      name_he:        'מדד מתפוצץ',
      description_he: 'קבוע בדיקה',
      unit:           'count',
      grain:          'week',
      direction:      'up_good',
      honesty_label:  null,
      benchmark:      null,
      formula:        () => { throw new Error('kaboom'); },
    };
    const values = computeMetrics([bomb], emptyInputs());
    expect(values[0].value).toBeNull();
    expect(values[0].not_computable_reason).toContain('kaboom');
    expect(values[0].not_computable_reason).toContain('שגיאת חישוב');
  });
});

describe('computeMetrics — comparisons (leap 4: never naked)', () => {
  it('delta_pct hand math: leads 4→8 = +100%; reconciliation 1→1.4 = +40%', () => {
    const values = computeMetrics(METRIC_REGISTRY, clinicInputs());
    expect(byKey(values, 'leads_total')).toMatchObject({ value: 8, prev: 4, delta_pct: 100 });
    expect(byKey(values, 'reconciliation_ratio')).toMatchObject({ value: 1.4, prev: 1, delta_pct: 40 });
  });

  it('prev = 0 → delta null (a change from zero is "new", not +∞%)', () => {
    const inputs: MetricInputs = { ...emptyInputs(), current: clinicInputs().current };
    const leads = byKey(computeMetrics(METRIC_REGISTRY, inputs), 'leads_total');
    expect(leads.prev).toBe(0);
    expect(leads.delta_pct).toBeNull();
  });

  it('prev not computable (no historical spend until H4) → delta honestly null', () => {
    const spend = byKey(computeMetrics(METRIC_REGISTRY, clinicInputs()), 'spend_total');
    expect(spend.value).toBe(700);
    expect(spend.prev).toBeNull();
    expect(spend.delta_pct).toBeNull();
  });

  it('vs_goal is direction-aware: up_good ≥, down_good ≤', () => {
    const values = computeMetrics(METRIC_REGISTRY, clinicInputs(), {
      leads_total:   10,   // up_good, 8 < 10  → not met
      cost_per_lead: 90,   // down_good, 87.5 ≤ 90 → met
    });
    expect(byKey(values, 'leads_total').vs_goal).toEqual({ target: 10, met: false });
    expect(byKey(values, 'cost_per_lead').vs_goal).toEqual({ target: 90, met: true });
    expect(byKey(values, 'qualified_rate').vs_goal).toBeNull(); // no goal set → no comparison invented
  });

  it('vs_benchmark comes only from the def: reconciliation 1.4 vs 1.2 (down_good) → not met', () => {
    const values = computeMetrics(METRIC_REGISTRY, clinicInputs());
    expect(byKey(values, 'reconciliation_ratio').vs_benchmark).toEqual({ target: 1.2, met: false });
    expect(byKey(values, 'leads_total').vs_benchmark).toBeNull();
  });

  it('null value → goal/benchmark comparisons are null (no comparing a ghost)', () => {
    const values = computeMetrics(METRIC_REGISTRY, emptyInputs(), { cost_per_lead: 50 });
    expect(byKey(values, 'cost_per_lead').vs_goal).toBeNull();
    expect(byKey(values, 'reconciliation_ratio').vs_benchmark).toBeNull();
  });

  it('carries the registry metadata every consumer grounds in (honesty labels intact)', () => {
    const values = computeMetrics(METRIC_REGISTRY, clinicInputs());
    expect(byKey(values, 'cost_per_lead').honesty_label).toBe('מבוסס קליקים');
    expect(byKey(values, 'spend_total').honesty_label).toContain('תקציב מתוכנן');
    expect(byKey(values, 'leads_total').honesty_label).toBeNull();
  });
});

describe('computeMetrics — determinism', () => {
  it('same inputs → byte-identical output', () => {
    const a = computeMetrics(METRIC_REGISTRY, clinicInputs(), { leads_total: 10 });
    const b = computeMetrics(METRIC_REGISTRY, clinicInputs(), { leads_total: 10 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('shuffled row order → identical output (formulas are order-blind)', () => {
    const shuffled = clinicInputs();
    shuffled.current.leads.reverse();
    shuffled.current.stageEvents.reverse();
    shuffled.current.reconciliation.reverse();
    shuffled.current.campaigns.reverse();
    shuffled.previous.leads.reverse();
    const a = computeMetrics(METRIC_REGISTRY, clinicInputs());
    const b = computeMetrics(METRIC_REGISTRY, shuffled);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe('periodDaysInclusive', () => {
  it('inclusive: one week = 7; a single day = 1', () => {
    expect(periodDaysInclusive(CURRENT_PERIOD)).toBe(7);
    expect(periodDaysInclusive({ start: '2026-06-22', end: '2026-06-22' })).toBe(1);
  });

  it('malformed or inverted period → 0 (formulas refuse it), never NaN', () => {
    expect(periodDaysInclusive({ start: 'nope', end: '2026-06-22' })).toBe(0);
    expect(periodDaysInclusive({ start: '2026-06-28', end: '2026-06-22' })).toBe(0);
  });
});
