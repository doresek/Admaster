// lib/intelligence/display.ts
//
// PURE, framework-free display helpers for the Client Intelligence UI. They
// translate the raw atom fields (confidence / source / timestamps) into the
// Hebrew labels, bands and colors the wall renders — and a couple of small
// decision helpers the page uses. Kept pure so they are trivially unit-tested
// (no React, no DOM, no Supabase).
import type { ClientInsight, InsightSource } from './types';

export type ConfidenceTone = 'high' | 'mid' | 'low';

export interface ConfidenceBand {
  tone:  ConfidenceTone;
  label: string;   // Hebrew band label
  /** Tailwind text color for the label/percentage. */
  text:  string;
  /** Tailwind background for the filled portion of the meter. */
  bar:   string;
}

/**
 * Map a 0..1 confidence into a Hebrew band: גבוה ≥ 0.8, בינוני 0.5–0.79,
 * נמוך < 0.5. Color-coded (emerald / amber / slate-rose).
 */
export function confidenceBand(confidence: number): ConfidenceBand {
  const c = Number.isFinite(confidence) ? confidence : 0;
  if (c >= 0.8) {
    return { tone: 'high', label: 'גבוה', text: 'text-emerald-300', bar: 'bg-emerald-500' };
  }
  if (c >= 0.5) {
    return { tone: 'mid', label: 'בינוני', text: 'text-amber-300', bar: 'bg-amber-500' };
  }
  return { tone: 'low', label: 'נמוך', text: 'text-rose-300', bar: 'bg-rose-500' };
}

/** Clamp a 0..1 confidence to an integer 0..100 percentage. */
export function confidencePct(confidence: number): number {
  const c = Number.isFinite(confidence) ? confidence : 0;
  return Math.max(0, Math.min(100, Math.round(c * 100)));
}

export interface SourceMeta {
  icon:  string;
  label: string;
}

/** The provenance chip for an atom's source. */
export function sourceMeta(source: InsightSource | string): SourceMeta {
  switch (source) {
    case 'brief':               return { icon: '📋', label: 'מהבריף' };
    case 'user_signal':         return { icon: '✓',  label: 'ממשוב' };
    case 'content_performance': return { icon: '📊', label: 'מביצועים' };
    case 'ai_synthesis':        return { icon: '🤖', label: 'הסקה' };
    default:                    return { icon: '•',  label: String(source) };
  }
}

const MINUTE = 60_000;
const HOUR   = 60 * MINUTE;
const DAY    = 24 * HOUR;

/**
 * A short Hebrew relative-time label for a freshness line. Falls back to a
 * he-locale date for anything older than ~30 days. Pure (now is injectable).
 */
export function relativeHe(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = now - t;
  if (diff < MINUTE)     return 'עכשיו';
  if (diff < HOUR)       { const m = Math.floor(diff / MINUTE); return `לפני ${m} ${m === 1 ? 'דקה' : 'דקות'}`; }
  if (diff < DAY)        { const h = Math.floor(diff / HOUR);   return `לפני ${h} ${h === 1 ? 'שעה' : 'שעות'}`; }
  if (diff < 30 * DAY)   { const d = Math.floor(diff / DAY);    return `לפני ${d} ${d === 1 ? 'יום' : 'ימים'}`; }
  try { return new Date(t).toLocaleDateString('he'); } catch { return ''; }
}

/** Average confidence across a set of atoms, as an integer percentage. */
export function avgConfidencePct(insights: Pick<ClientInsight, 'confidence'>[]): number {
  if (!insights.length) return 0;
  const sum = insights.reduce((acc, i) => acc + (Number.isFinite(i.confidence) ? i.confidence : 0), 0);
  return Math.round((sum / insights.length) * 100);
}

/**
 * The page is in "build-in-progress" mode when the brain has produced nothing
 * yet: no active atoms AND no synthesized strategy timestamp.
 */
export function shouldShowBuilding(
  insights: Pick<ClientInsight, 'id'>[],
  coreGeneratedAt: string | null | undefined,
): boolean {
  return insights.length === 0 && !coreGeneratedAt;
}
