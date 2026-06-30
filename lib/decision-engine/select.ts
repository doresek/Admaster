// lib/decision-engine/select.ts
//
// Internal, pure atom-selection helpers shared by decide / audience / diagnose.
// Deterministic ordering everywhere: confidence desc, then evidence_count desc,
// then id asc — so the same atoms always produce the same decision.
import type { Insight } from './types';

/** Only ACTIVE atoms participate in decisions (superseded/refuted are ignored). */
export function activeInsights(insights: Insight[]): Insight[] {
  return (insights ?? []).filter((a) => a && a.status === 'active');
}

/** Stable, deterministic ranking comparator (highest-confidence first). */
export function byConfidence(a: Insight, b: Insight): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  const ea = a.evidence_count ?? 0;
  const eb = b.evidence_count ?? 0;
  if (eb !== ea) return eb - ea;
  return (a.id ?? '').localeCompare(b.id ?? '');
}

/** Atoms of a layer + (optionally) a set of kinds, ranked. */
export function pick(
  insights: Insight[],
  layer: Insight['layer'],
  kinds?: string[],
): Insight[] {
  const kindSet = kinds ? new Set(kinds) : null;
  return activeInsights(insights)
    .filter((a) => a.layer === layer && (!kindSet || kindSet.has(a.kind)))
    .sort(byConfidence);
}

/** The single highest-confidence atom across the given kinds (priority by rank). */
export function top(
  insights: Insight[],
  layer: Insight['layer'],
  kinds: string[],
): Insight | undefined {
  return pick(insights, layer, kinds)[0];
}

/** Read a finite number off an atom's `structured` blob, if present. */
export function structuredNumber(atom: Insight | undefined, key: string): number | undefined {
  const v = atom?.structured?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Read a string off an atom's `structured` blob, if present. */
export function structuredString(atom: Insight | undefined, key: string): string | undefined {
  const v = atom?.structured?.[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Short, single-line preview of an atom's content for rationale strings. */
export function preview(text: string, max = 80): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Format a confidence for rationale strings, e.g. 0.8. */
export function conf(c: number): string {
  return (Math.round(c * 100) / 100).toString();
}
