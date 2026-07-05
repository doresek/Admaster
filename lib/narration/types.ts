// lib/narration/types.ts
//
// Typed FACTS for the general narration engine (D-0, DASHBOARD-ARCHITECTURE
// §0.2): "deterministic-first — selects and templates from real rows: metrics
// deltas, diagnosis rationales, atom states … every clause traces to a row; no
// number appears that isn't in the inputs."
//
// The engine is deliberately NOT the digest composer (that stays a sibling):
// this is the GENERAL surface every dashboard consumes — same anti-
// hallucination discipline, register-aware (owner vs marketer), fed by the
// metrics layer instead of raw tables.

import type { MetricValue } from '@/lib/metrics-layer';

/**
 * Language register (§1 viewer modes): 'owner' is business-warm/dugri with
 * ZERO platform jargon (no CTR/ROAS/CPM — leads, cost, worth-it framing);
 * 'marketer' gets the fuller vocabulary. Same facts, different templates.
 */
export type NarrationRegister = 'owner' | 'marketer';

/** A diagnosis-engine verdict, narrated by its recorded rationale VERBATIM. */
export interface DiagnosisFact {
  id:             string;
  rationale:      string;
  campaign_name?: string | null;
}

/** A grounding atom citation; missing confidence is cited as missing, never invented. */
export interface AtomCiteFact {
  id:         string;
  content:    string;
  confidence: number | null;
}

/** An action awaiting the user's one-tap approval (leap 6 — act from here). */
export interface PendingActionFact {
  id:        string;
  kind:      string;
  rationale: string;
}

/** A pre-computed forecast range — the engine ECHOES it, never derives one (leap 5). */
export interface ForecastRangeFact {
  low:      number;
  high:     number;
  /** e.g. 'לידים עד סוף הרבעון' — the caller names the quantity. */
  label_he: string;
}

/** YYYY-MM-DD inclusive. */
export interface NarrationPeriod {
  start: string;
  end:   string;
}

/** Everything the engine may narrate — all typed facts, no free text-in. */
export interface NarrationInput {
  period:         NarrationPeriod;
  metrics:        MetricValue[];
  diagnoses:      DiagnosisFact[];
  atoms:          AtomCiteFact[];
  pendingActions: PendingActionFact[];
}

export interface NarrationResult {
  text_he:  string;
  /** Namespaced ids of every fact that contributed a clause — the audit trail. */
  sources:  string[];
  warnings: string[];
}

// ── story (the dashboard headline block) ─────────────────────────────────────

export interface StoryExtras {
  topDiagnosis?:   DiagnosisFact;
  pendingActions?: PendingActionFact[];
  forecastRange?:  ForecastRangeFact;
}

/**
 * The single-client dashboard headline block (§1 viewer mode A): one-line
 * story, ≤3 supporting lines (the "don't dump 50 numbers" law), optional
 * pending/forecast lines and an optional heads-up.
 */
export interface ClientStory {
  headline_he: string;
  /** Deterministically ranked highlights — hard-capped at 3. */
  lines_he:    string[];
  pending_he:  string | null;
  forecast_he: string | null;
  heads_up_he: string | null;
  sources:     string[];
  warnings:    string[];
}
