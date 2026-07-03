// lib/attention/types.ts
//
// C-06 attention scheduler — shared vocabulary (MARKETING-CAPABILITIES-SPEC
// C-06, AI-MARKETER-VISION-DEEP §8.2.2).
//
// The scheduler ranks clients by INFORMATION VALUE, not revenue: a tiny client
// on the verge of resolving a high-leverage hypothesis outranks a big quiet
// one. Tiers cap FREQUENCY (how often a client is ticked), never RIGOR (what
// the tick does) — nothing in this module ever reads spend or plan tier.
//
// Two shapes cross this module's boundary:
//   • ClientAttentionState — the INPUT snapshot, assembled from the existing
//     ledgers by lib/attention/load (or handed in directly by tests/heartbeat).
//   • AttentionScore — the OUTPUT: one normalized score per client plus a
//     per-component breakdown. Every component carries a plain-language reason
//     because auditability is a REQUIREMENT: "why did client X get attention
//     today" must be answerable from the logged score alone.

import type { HypothesisRow } from '@/lib/capability-contracts';

// ── Input snapshot ────────────────────────────────────────────────────────────

/** Severity scale shared by anomaly and error flags. */
export type FlagSeverity = 'low' | 'med' | 'high';

/**
 * A reflex-tier anomaly flag. The reflex tier (C-05) does not exist yet, so
 * this shape is deliberately generic and forward-compatible: `kind` is free
 * text (e.g. 'spend_spike_no_results', 'ctr_cliff'), and load.ts emits an
 * empty list today. Scoring is fully implemented so C-05 plugs in with zero
 * changes here.
 */
export interface AnomalyFlag {
  kind:     string;
  severity: FlagSeverity;
  /** Hours since the anomaly fired. Fresh anomalies dominate (see scoreAnomalies). */
  ageHours: number;
}

/** One open hypothesis (C-01) with its progress toward a verdict. */
export interface OpenHypothesisProgress {
  hypothesis: HypothesisRow;
  /**
   * Progress toward the registered sample floor, typically in [0..1]
   * (1 = floor met; may exceed 1 when the floor is overshot but the verdict
   * has not landed yet). 0 when unknown — without a live metrics pipe, load.ts
   * cannot measure progress and reports 0 unless an observations map is injected.
   */
  sampleProgress: number;
  /**
   * How many downstream decisions the claim unblocks. Derived from the
   * hypothesis's gated atom count (insight_ids) weighted by domain — see
   * DOMAIN_DECISION_MULTIPLIER in load.ts. Tunable, not sacred.
   */
  decisionWeight: number;
}

/** Freshness of the client's knowledge core (insight_events is the source). */
export interface StalenessState {
  /**
   * Days since the last insight_events row for this client, or null when the
   * client has NO atom events at all — i.e. the brain has never touched them.
   */
  daysSinceLastAtomEvent: number | null;
  /** The expected analysis rhythm in days; staleness only accrues past this. */
  cadenceDays: number;
}

/** An upcoming seasonality window (from `kind: 'seasonality'` atoms). */
export interface CalendarProximity {
  /** Human label for the window (the atom's content, or structured label). */
  windowLabel: string;
  /** Days until the window OPENS; 0 when we are currently inside the window. */
  daysUntilWindow: number;
  /**
   * The vertical's decision lag in days (israeli-market-timing §4-5): customers
   * decide this long BEFORE the event window, so the marketing moment is
   * daysUntilWindow − decisionLagDays — act at the DECISION window, not the
   * event window.
   */
  decisionLagDays: number;
  /** Confidence of the seasonality atom in [0..1]. */
  relevanceConfidence: number;
}

/** Pipeline error kinds. A broken pipe starves every other signal. */
export type ErrorKind = 'meta_token_expiring' | 'connection_error' | 'other';

export interface ErrorFlag {
  kind:     ErrorKind;
  severity: FlagSeverity;
}

/**
 * Everything the scorer needs to know about one client, assembled from the
 * existing ledgers. Pure data — no client handles, no clocks — so scoring is
 * deterministic: same state, same score.
 */
export interface ClientAttentionState {
  clientId:       string;
  ownerUserId:    string;
  /** Unresolved reflex flags. Empty today (C-05 pending); shape is ready. */
  anomalyFlags:   AnomalyFlag[];
  openHypotheses: OpenHypothesisProgress[];
  staleness:      StalenessState;
  calendar:       CalendarProximity[];
  errorStates:    ErrorFlag[];
  /**
   * Campaigns in an active state ('live' | 'publishing' | 'scheduled').
   * Context only — it does NOT feed the score (that would smuggle spend/size
   * back into attention, which §8.2.2 forbids). Consumers may use it for
   * per-tick compute budgeting.
   */
  activeCampaigns: number;
}

// ── Output ────────────────────────────────────────────────────────────────────

/**
 * One normalized component of the attention score: a value in [0..1] plus the
 * plain-language reason it has that value. Reasons surface to the user in the
 * heartbeat audit log, so they must be TRUE statements about the input.
 */
export interface AttentionComponent {
  value:  number;
  reason: string;
}

export interface AttentionComponents {
  anomaly:         AttentionComponent;
  hypothesisValue: AttentionComponent;
  staleness:       AttentionComponent;
  calendar:        AttentionComponent;
  errors:          AttentionComponent;
}

/** The scheduler's verdict for one client. */
export interface AttentionScore {
  clientId:   string;
  /** Weighted sum of the normalized components — in [0..1] under DEFAULT_WEIGHTS. */
  score:      number;
  components: AttentionComponents;
}

/** Per-component weights. See DEFAULT_WEIGHTS in score.ts for the rationale. */
export interface AttentionWeights {
  anomaly:         number;
  hypothesisValue: number;
  staleness:       number;
  calendar:        number;
  errors:          number;
}
