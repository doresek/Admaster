// lib/decision-engine/types.ts
//
// The PUBLIC CONTRACT of the Decision Engine (T1 — "the moat").
//
// This module is PURE: it turns the LIVING client understanding
// (client_insights atoms + the synthesized client_strategy) into concrete
// marketing decisions and failure diagnoses. It is INSIGHT-DRIVEN, never
// metric-blind — every choice records the atom ids it is `grounded_in` and a
// plain-language `rationale` that cites the atom and its confidence.
//
// No DB / network / LLM lives here. The engine receives data and returns
// decisions, so the whole core is deterministically unit-testable.
import type { ClientInsight } from '@/lib/intelligence/types';
import type { StrategyAnalysis } from '@/lib/analyze-brief';

// Re-export the atom shape under the name the contract uses, so consumer
// modules can `import type { Insight } from '@/lib/decision-engine'`.
export type { ClientInsight } from '@/lib/intelligence/types';
export type Insight = ClientInsight;
export type { StrategyAnalysis } from '@/lib/analyze-brief';

/** The ad platforms the engine can target. */
export type Platform = 'facebook' | 'instagram' | 'whatsapp';

/** Funnel stage, derived from the customer's Schwartz awareness level. */
export type FunnelStage = 'TOFU' | 'MOFU' | 'BOFU';

/** Gender targeting (Meta-compatible). */
export type Genders = 'all' | 'male' | 'female';

/**
 * The audience definition, DERIVED FROM customers-layer atoms — never a preset.
 * `interests` are seed phrases pulled from the desire/aspiration/persona atoms
 * (a downstream Meta-mapper turns them into interest ids); the hints describe
 * custom-audience / lookalike strategy implied by the awareness level + persona.
 */
export interface TargetingSpec {
  geo:                   string;
  age_min:               number;
  age_max:               number;
  genders:               Genders;
  interests:             string[];
  custom_audience_hint?: string;
  lookalike_hint?:       string;
}

/**
 * One end-to-end marketing decision. `grounded_in` lists the client_insights ids
 * every choice was drawn from; `rationale` explains the decision citing those
 * atoms + their confidence.
 */
export interface MarketingDecision {
  angle:          string;
  sub_audience:   string;
  targeting_spec: TargetingSpec;
  platform:       Platform;
  placement:      string[];
  objective:      string;
  funnel_stage:   FunnelStage;
  daily_budget:   number;
  grounded_in:    string[];
  rationale:      string;
}

/** The marketing LINK that broke, interpreted THROUGH the insights. */
export type FailedLink =
  | 'hook'
  | 'avatar'
  | 'creative'
  | 'funnel'
  | 'offer'
  | 'audience'
  | 'none';

/**
 * A failure diagnosis. `target_insight_ids` are the atoms the diagnosis hinges
 * on (e.g. the unresolved objection that makes a conversion drop an OFFER
 * failure, not a creative one); `recommended_action` is a structured next move.
 */
export interface Diagnosis {
  failed_link:        FailedLink;
  rationale:          string;
  target_insight_ids: string[];
  recommended_action: Record<string, unknown>;
}

/** Minimal client context the engine reads (a structural subset of `Client`). */
export interface DecisionClientContext {
  id?:             string;
  name?:           string | null;
  /** Optional monthly budget (ILS) override; drives the daily budget when set. */
  monthly_budget?: number | null;
  /** Optional geo override (e.g. "IL", "Tel Aviv"); defaults to "IL". */
  default_geo?:    string | null;
}

/** Input to `decide`. */
export interface DecideInput {
  client?:   DecisionClientContext | null;
  insights:  Insight[];
  strategy?: StrategyAnalysis | null;
}

/** A creative artifact under diagnosis (what was actually shipped). */
export interface DiagnosedArtifact {
  angle?:        string;
  hook?:         string;
  sub_audience?: string;
  funnel_stage?: FunnelStage;
  /** client_insights ids this artifact was grounded in (from a prior decision). */
  grounded_in?:  string[];
}

/** A single variant's performance (used to detect avatar/hook-level failure). */
export interface VariantMetrics {
  hook?:            string;
  avatar?:          string;
  impressions?:     number;
  clicks?:          number;
  ctr?:             number;
  conversions?:     number;
  conversion_rate?: number;
}

/** Aggregate + optional per-variant performance metrics. */
export interface PerformanceMetrics {
  impressions?:     number;
  clicks?:          number;
  /** Click-through rate as a FRACTION (0..1). Derived from clicks/impressions if absent. */
  ctr?:             number;
  conversions?:     number;
  /** Conversion rate as a FRACTION (0..1). Derived from conversions/clicks if absent. */
  conversion_rate?: number;
  spend?:           number;
  reach?:           number;
  /** Average impressions per person; high values signal audience saturation. */
  frequency?:       number;
  /** Optional per-variant breakdown for avatar/hook-level diagnosis. */
  variants?:        VariantMetrics[];
}

/** Input to `diagnoseFailure`. */
export interface DiagnoseInput {
  artifact?:   DiagnosedArtifact | null;
  performance: { metrics: PerformanceMetrics };
  insights:    Insight[];
}
