// lib/narration/story.ts
//
// buildClientStory — the single-client dashboard headline block (§1 viewer
// mode A): one-line story + ≤3 supporting lines + optional pending/forecast
// lines + optional heads-up. Same anti-hallucination contract as the engine:
// every number is String(input field); ranking uses numbers for SELECTION
// only, never renders a computed one.
//
// The ranking law (§0.4: ≤10 KPIs, "don't dump 50 numbers"): highlights are
// the metrics that MOVED most where movement matters — |delta| ranked with
// direction-badness first, hard-capped at 3.

import type { MetricValue } from '@/lib/metrics-layer';
import { badness, cmp, deltaClause, fmtValue, leadsPhrase, sortedUnique } from './format';
import type { ClientStory, StoryExtras } from './types';

const byKey = (metrics: readonly MetricValue[], key: string): MetricValue | null =>
  metrics.find((m) => m.key === key) ?? null;

/**
 * Deterministic attention ranking — "biggest |delta| × direction-badness
 * first": metrics that moved the WRONG way outrank good news, then bigger
 * movement outranks smaller, then key asc as the total tie-break —
 * shuffle-invariant by construction.
 */
function rankHighlights(metrics: readonly MetricValue[]): MetricValue[] {
  const isBad = (m: MetricValue): number => (badness(m) > 0 ? 1 : 0);
  return metrics
    .filter((m) => m.value !== null && m.delta_pct !== null && m.delta_pct !== 0)
    .sort((a, b) =>
      isBad(b) - isBad(a)
      || Math.abs(b.delta_pct ?? 0) - Math.abs(a.delta_pct ?? 0)
      || cmp(a.key, b.key));
}

/** The dashboard headline block from computed metrics + optional extras. */
export function buildClientStory(
  metricValues: readonly MetricValue[],
  extras:       StoryExtras = {},
): ClientStory {
  const warnings: string[] = [];
  const sources = new Set<string>();

  // ── one-line story: leads · cost-per-lead · worth-it (owner framing) ──
  const headBits: string[] = [];
  const leads = byKey(metricValues, 'leads_total');
  if (leads !== null && leads.value !== null) {
    headBits.push(leadsPhrase(leads.value));
    sources.add(`metric:${leads.key}`);
  }
  const cpl = byKey(metricValues, 'cost_per_lead');
  if (cpl !== null && cpl.value !== null) {
    headBits.push(`₪${String(cpl.value)} לליד`);
    sources.add(`metric:${cpl.key}`);
  }
  const roas = byKey(metricValues, 'roas_vs_breakeven');
  if (roas !== null && roas.value !== null) {
    headBits.push(roas.value >= 1 ? 'משתלם ✅' : 'עדיין לא משתלם ⚠️');
    sources.add(`metric:${roas.key}`);
  }
  const headline = headBits.length > 0
    ? headBits.join(' · ')
    : 'עוד אין מספיק נתונים לתקופה הזו — נעדכן ברגע שייכנסו.';

  // ── ≤3 ranked highlights ──
  const lines: string[] = [];
  const ranked = rankHighlights(metricValues);
  for (const m of ranked.slice(0, 3)) {
    const delta = deltaClause(m);
    const value = m.value !== null ? fmtValue(m.value, m.unit) : '';
    lines.push(`${m.name_he}: ${value}${delta !== null ? ` (${delta})` : ''}`);
    sources.add(`metric:${m.key}`);
  }

  // ── pending actions (leap 6) — count agreement + first rationale verbatim ──
  let pending: string | null = null;
  const actions = [...(extras.pendingActions ?? [])].sort((a, b) => cmp(a.id, b.id));
  if (actions.length > 0) {
    const first = actions[0];
    pending = actions.length === 1
      ? `⚡ ממתין לך: ${first.rationale}`
      : `⚡ ממתינות לך ${String(actions.length)} פעולות — הראשונה: ${first.rationale}`;
    for (const a of actions) sources.add(`action:${a.id}`);
  }

  // ── forecast (leap 5: a range, echoed — never derived here) ──
  let forecast: string | null = null;
  if (extras.forecastRange !== undefined) {
    const f = extras.forecastRange;
    forecast = `📈 בקצב הזה: סביר בין ${String(f.low)} ל-${String(f.high)} ${f.label_he}`;
  }

  // ── heads-up: the worst direction-bad mover, else the top diagnosis ──
  let headsUp: string | null = null;
  const worst = ranked.find((m) => badness(m) > 0);
  if (worst !== undefined) {
    const delta = deltaClause(worst);
    headsUp = `שים לב: ${worst.name_he} ${delta ?? ''}`.trimEnd();
    sources.add(`metric:${worst.key}`);
  } else if (extras.topDiagnosis !== undefined) {
    headsUp = `שים לב: ${extras.topDiagnosis.rationale}`;
    sources.add(`diagnosis:${extras.topDiagnosis.id}`);
  }

  return {
    headline_he: headline,
    lines_he:    lines,
    pending_he:  pending,
    forecast_he: forecast,
    heads_up_he: headsUp,
    sources:     sortedUnique(sources),
    warnings,
  };
}
