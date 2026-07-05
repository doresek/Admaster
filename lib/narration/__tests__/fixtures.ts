// Typed fact fixtures for the narration tests. MetricValue facts are built
// fully typed (what computeMetrics emits) with the clinic-scenario numbers, so
// engine/story assertions can hand-check every rendered token.

import type { MetricValue } from '@/lib/metrics-layer';
import type { NarrationInput } from '../types';

export function makeMetric(over: Partial<MetricValue> & { key: MetricValue['key'] }): MetricValue {
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

/** The computed clinic metrics (values mirror the metrics-layer fixtures). */
export function clinicMetrics(): MetricValue[] {
  return [
    makeMetric({ key: 'leads_total', name_he: 'לידים', unit: 'count', direction: 'up_good',
                 value: 8, prev: 4, delta_pct: 100, vs_goal: { target: 10, met: false } }),
    makeMetric({ key: 'cost_per_lead', name_he: 'עלות לליד', unit: 'ils', direction: 'down_good',
                 honesty_label: 'מבוסס קליקים', value: 87.5, prev: 65, delta_pct: 34.6 }),
    makeMetric({ key: 'roas_vs_breakeven', name_he: 'יחס לנקודת האיזון', unit: 'ratio',
                 direction: 'up_good', honesty_label: 'מבוסס קליקים', value: 4 }),
    makeMetric({ key: 'qualified_rate', name_he: 'אחוז לידים רלוונטיים', unit: 'pct',
                 direction: 'up_good', value: 50, prev: 25, delta_pct: 100 }),
    makeMetric({ key: 'spend_total', name_he: 'השקעה בפרסום', unit: 'ils', direction: 'down_good',
                 honesty_label: 'תקציב מתוכנן — לא הוצאה בפועל מהפלטפורמה', value: 700 }),
    makeMetric({ key: 'reconciliation_ratio', name_he: 'יחס דיווח פלטפורמה מול CRM', unit: 'ratio',
                 direction: 'down_good', value: 1.4, prev: 1, delta_pct: 40,
                 vs_benchmark: { target: 1.2, met: false } }),
    makeMetric({ key: 'closed_value', name_he: 'הכנסה מעסקאות שנסגרו', unit: 'ils',
                 direction: 'up_good', value: 7000 }),
    makeMetric({ key: 'close_rate', name_he: 'אחוז סגירה', unit: 'pct', direction: 'up_good',
                 value: null, not_computable_reason: 'אף עסקה לא הוכרעה בתקופה — אין ממה לחשב אחוז סגירה' }),
  ];
}

export function clinicNarrationInput(): NarrationInput {
  return {
    period:  { start: '2026-06-22', end: '2026-06-28' },
    metrics: clinicMetrics(),
    diagnoses: [
      { id: 'diag-fatigue', rationale: 'הקהל ראה את המודעה 4 פעמים — עייפות קריאייטיב, לא בעיית הצעה', campaign_name: 'קמפיין שקט נפשי' },
    ],
    atoms: [
      { id: 'atom-safety', content: 'ההורים קונים שקט נפשי, לא טכנולוגיה', confidence: 0.85 },
      { id: 'atom-stale',  content: 'קהל צעיר מגיב לוידאו קצר', confidence: null },
    ],
    pendingActions: [
      { id: 'act-refresh', kind: 'create_paid_paused', rationale: 'אשר רענון קריאייטיב לקמפיין שקט נפשי' },
    ],
  };
}

/** No computable facts at all — the honest-empty branch. */
export function emptyNarrationInput(): NarrationInput {
  return {
    period:         { start: '2026-06-22', end: '2026-06-28' },
    metrics:        [makeMetric({ key: 'leads_total', name_he: 'לידים', not_computable_reason: 'אין לידים בתקופה' })],
    diagnoses:      [],
    atoms:          [],
    pendingActions: [],
  };
}
