// lib/narration/format.ts
//
// Deterministic Hebrew formatting helpers shared by the engine and the story
// builder. THE RULE (§0.2 anti-hallucination): every helper INTERPOLATES input
// values via String(...) — none of them performs arithmetic that could mint a
// number the inputs don't already contain. (Math.abs only strips a sign; the
// digits are unchanged, so the whitelist invariant holds.)

import type { MetricUnit, MetricValue } from '@/lib/metrics-layer';

/** Byte-deterministic compare (no localeCompare — locale-independent). */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const sortedUnique = (ids: Iterable<string>): string[] =>
  [...new Set(ids)].sort(cmp);

/** '2026-06-22' → '22.06.2026' (IL format, no locale APIs — deterministic). */
export function ilDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d !== undefined && m !== undefined && y !== undefined ? `${d}.${m}.${y}` : iso;
}

/** Echo a metric value verbatim with its unit dressing. */
export function fmtValue(value: number, unit: MetricUnit): string {
  switch (unit) {
    case 'ils':   return `₪${String(value)}`;
    case 'pct':   return `${String(value)}%`;
    case 'ratio': return `פי ${String(value)}`;
    case 'count': return String(value);
  }
}

/** Singular/plural agreement for leads: 'ליד אחד' / '2 לידים'. */
export function leadsPhrase(n: number): string {
  return n === 1 ? 'ליד אחד' : `${String(n)} לידים`;
}

/**
 * Direction-adjusted badness of a delta: positive = moved the WRONG way.
 * Used only for SELECTING/ORDERING clauses (never rendered as a number).
 */
export function badness(m: MetricValue): number {
  if (m.delta_pct === null) return 0;
  return m.direction === 'up_good' ? -m.delta_pct : m.delta_pct;
}

/**
 * Verdict clause from direction + delta ("↑12% — שיפור" / "↓8% — טעון תשומת
 * לב"). The rendered percentage is the input delta with only its sign
 * stripped — no new digits.
 */
export function deltaClause(m: MetricValue): string | null {
  if (m.delta_pct === null) return null;
  if (m.delta_pct === 0) return 'ללא שינוי מהתקופה הקודמת';
  const arrow = m.delta_pct > 0 ? '↑' : '↓';
  const good = badness(m) < 0;
  return `${arrow}${String(Math.abs(m.delta_pct))}% — ${good ? 'שיפור' : 'טעון תשומת לב'}`;
}

/** Direction-aware goal clause, echoing the goal verbatim. */
export function goalClause(m: MetricValue): string | null {
  if (m.vs_goal === null) return null;
  const target = fmtValue(m.vs_goal.target, m.unit);
  if (m.vs_goal.met) {
    return m.direction === 'up_good' ? `מעל היעד (${target})` : `טוב מהיעד (${target})`;
  }
  return m.direction === 'up_good' ? `מתחת ליעד (${target})` : `מעל היעד (${target}) — טעון שיפור`;
}

/** Benchmark clause — only ever rendered from a def's honest static prior. */
export function benchmarkClause(m: MetricValue): string | null {
  if (m.vs_benchmark === null) return null;
  const target = fmtValue(m.vs_benchmark.target, m.unit);
  return m.vs_benchmark.met ? `בטווח הבריא (עד ${target})` : `חורג מהצפוי (${target})`;
}
