// METRIC_REGISTRY — hand-math proof per metric over the clinic scenario
// (fixtures.ts documents the arithmetic). Formulas are pure: each test calls
// def.formula(slice, ctx) directly and compares against numbers computed BY
// HAND, so a formula regression cannot hide behind its own output.

import { describe, expect, it } from 'vitest';
import type { FormulaContext, MetricKey, MetricResult, PeriodSlice } from '../types';
import { METRIC_REGISTRY, metricDef } from '../registry';
import { clinicInputs, emptyInputs, makeCampaign, makeEconomics, makeEvent } from './fixtures';

function run(key: MetricKey, slice: PeriodSlice, ctx?: Partial<FormulaContext>): MetricResult {
  const def = metricDef(key);
  if (def === null) throw new Error(`registry has no metric '${key}'`);
  return def.formula(slice, { economics: clinicInputs().economics, periodDays: 7, ...ctx });
}

const current = () => clinicInputs().current;

describe('METRIC_REGISTRY — integrity', () => {
  it('holds exactly the 12 launch metrics with unique keys and Hebrew names', () => {
    expect(METRIC_REGISTRY).toHaveLength(12);
    const keys = METRIC_REGISTRY.map((d) => d.key);
    expect(new Set(keys).size).toBe(12);
    for (const def of METRIC_REGISTRY) {
      expect(def.name_he.length).toBeGreaterThan(0);
      expect(def.description_he.length).toBeGreaterThan(0);
      // Hebrew display names, per §0.1 (the registry IS the Hebrew source of truth).
      expect(/[֐-׿]/.test(def.name_he)).toBe(true);
    }
  });

  it('metricDef returns null for unknown keys (no throw, no fallback def)', () => {
    expect(metricDef('made_up_metric')).toBeNull();
  });

  it('only the documented static benchmark exists (reconciliation @1.2 — Meta over-reporting prior)', () => {
    const withBenchmark = METRIC_REGISTRY.filter((d) => d.benchmark !== null);
    expect(withBenchmark.map((d) => d.key)).toEqual(['reconciliation_ratio']);
    expect(withBenchmark[0].benchmark).toBe(1.2);
  });
});

describe('funnel metrics — hand math', () => {
  it('leads_total: 8 leads in the period', () => {
    expect(run('leads_total', current())).toEqual({ value: 8, reason: null });
  });

  it('leads_qualified: union of current_stage and in-period events = 4 (incl. lead-8 via EVENT only)', () => {
    expect(run('leads_qualified', current())).toEqual({ value: 4, reason: null });
  });

  it('qualified_rate: 4/8 = 50%', () => {
    expect(run('qualified_rate', current())).toEqual({ value: 50, reason: null });
  });

  it('irrelevant_rate: 1/8 = 12.5%', () => {
    expect(run('irrelevant_rate', current())).toEqual({ value: 12.5, reason: null });
  });

  it('close_rate: won {lead-3, lead-old} vs lost {lead-8} → 2/3 = 66.67%', () => {
    expect(run('close_rate', current())).toEqual({ value: 66.67, reason: null });
  });

  it('closed_value: 4200 + 2800 = ₪7000', () => {
    expect(run('closed_value', current())).toEqual({ value: 7000, reason: null });
  });

  it('closed_value: zero closes → an HONEST 0, not null', () => {
    const slice = { ...current(), stageEvents: current().stageEvents.filter((e) => e.stage !== 'closed_won') };
    expect(run('closed_value', slice)).toEqual({ value: 0, reason: null });
  });

  it('closed_value: closes exist but carry no value → null with a fix-it reason', () => {
    const slice = {
      ...current(),
      stageEvents: [makeEvent({ id: 'ev-nv', lead_id: 'lead-3', stage: 'closed_won', value: null })],
    };
    const r = run('closed_value', slice);
    expect(r.value).toBeNull();
    expect(r.reason).toContain('בלי ערך רשום');
  });

  it('contacted_24h_rate: 4/8 = 50% (23h in; 36h out; untouched leads count in the denominator)', () => {
    expect(run('contacted_24h_rate', current())).toEqual({ value: 50, reason: null });
  });

  it('consent_rate: 3/8 = 37.5% (explicit consent only — חוק הספאם)', () => {
    expect(run('consent_rate', current())).toEqual({ value: 37.5, reason: null });
  });

  it('rate metrics over an empty cohort → null with "אין לידים", never 0/0', () => {
    const empty = emptyInputs().current;
    for (const key of ['qualified_rate', 'irrelevant_rate', 'contacted_24h_rate', 'consent_rate'] as const) {
      const r = run(key, empty);
      expect(r.value, key).toBeNull();
      expect(r.reason, key).toContain('אין לידים');
    }
  });
});

describe('money metrics — hand math + gating honesty', () => {
  it('spend_total: only live non-dry-run budgets count → 100 × 7 = ₪700', () => {
    expect(run('spend_total', current())).toEqual({ value: 700, reason: null });
  });

  it('spend_total: no live campaigns → null with the H4-gated reason', () => {
    const slice = { ...current(), campaigns: [makeCampaign({ id: 'c-dry', dry_run: true, daily_budget: 100 })] };
    const r = run('spend_total', slice);
    expect(r.value).toBeNull();
    expect(r.reason).toContain('אין קמפיינים חיים');
  });

  it('spend_total: unparseable period (periodDays 0) → null, never budget × 0', () => {
    const r = run('spend_total', current(), { periodDays: 0 });
    expect(r).toEqual({ value: null, reason: 'תקופה לא תקינה — לא ניתן לחשב הוצאה' });
  });

  it('cost_per_lead: 700/8 = ₪87.5', () => {
    expect(run('cost_per_lead', current())).toEqual({ value: 87.5, reason: null });
  });

  it('cost_per_lead: spend unavailable → propagates the spend reason', () => {
    const slice = { ...current(), campaigns: [] };
    const r = run('cost_per_lead', slice);
    expect(r.value).toBeNull();
    expect(r.reason).toContain('אין קמפיינים חיים');
  });

  it('roas_vs_breakeven: ROAS 7000/700=10 ÷ break-even 100/40=2.5 → 4', () => {
    expect(run('roas_vs_breakeven', current())).toEqual({ value: 4, reason: null });
  });

  it('roas_vs_breakeven: no economics → null asking for margin inputs', () => {
    const r = run('roas_vs_breakeven', current(), { economics: null });
    expect(r.value).toBeNull();
    expect(r.reason).toContain('חסרים נתוני כלכלה');
  });

  it('roas_vs_breakeven: NaN-poisoned margin → treated as missing, not propagated', () => {
    const r = run('roas_vs_breakeven', current(), {
      economics: makeEconomics({ contribution_margin_pct: Number.NaN }),
    });
    expect(r.value).toBeNull();
    expect(r.reason).toContain('חסרים נתוני כלכלה');
  });
});

describe('reconciliation_ratio — hand math', () => {
  it('weighted across channels: (12+2)/(8+2) = 1.4', () => {
    expect(run('reconciliation_ratio', current())).toEqual({ value: 1.4, reason: null });
  });

  it('no rows → null (the monthly job has not run)', () => {
    const r = run('reconciliation_ratio', { ...current(), reconciliation: [] });
    expect(r.value).toBeNull();
    expect(r.reason).toContain('אין נתוני הצלבה');
  });

  it('zero CRM truth → null (undefined ratio), never Infinity', () => {
    const slice = {
      ...current(),
      reconciliation: current().reconciliation.map((r) => ({ ...r, crm_truth: 0 })),
    };
    const r = run('reconciliation_ratio', slice);
    expect(r.value).toBeNull();
    expect(r.reason).toContain('היחס לא מוגדר');
  });
});
