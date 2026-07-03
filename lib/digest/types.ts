// lib/digest/types.ts
//
// Internal types for the WEEKLY/MONTHLY DIGEST COMPOSER (VISION-DEEP §1.3).
//
// THE DESIGN CONTRACT (§1.3): "Nothing here is generated 'creatively' — every
// clause is a read from campaign_decisions.rationale, diagnoses.rationale, and
// atom states. The report is the audit trail, narrated." These types encode
// that contract structurally: every item in a DigestContent section carries
// the id of the recorded row it was read from, and ComposeResult.sources is
// the exact set of contributing row ids — nothing in the rendered narrative
// exists without a row behind it.
//
// PURE types only — no DB, no network. Row shapes not owned by a landed
// library (diagnoses, content_performance) are mirrored here from migration
// 030_ai_marketer.sql, narrowed to the digest's read set.

import type { Campaign, CampaignDecision } from '@/lib/campaigns/types';
import type { ClientInsight } from '@/lib/intelligence/types';
import type {
  DigestKind,
  DigestSources,
  HypothesisRow,
} from '@/lib/capability-contracts';

// ── source-row shapes (read set) ───────────────────────────────────────────────

/** `diagnoses.failed_link` (migration 030 §5 CHECK constraint). */
export type DigestFailedLink =
  | 'hook' | 'avatar' | 'creative' | 'funnel' | 'offer' | 'audience' | 'none';

/** A `public.diagnoses` row, narrowed to what the digest narrates. */
export interface DigestDiagnosisRow {
  id:                string;
  client_id:         string;
  owner_user_id:     string;
  scope_campaign_id: string | null;
  scope_item_id:     string | null;
  failed_link:       DigestFailedLink;
  rationale:         string;   // narrated VERBATIM — never paraphrased
  created_at:        string;
}

/** `content_performance.verdict` (migration 030 §4 CHECK constraint). */
export type PerformanceVerdict = 'worked' | 'underperformed' | 'failed';

/** A `public.content_performance` row, narrowed to what the digest narrates. */
export interface DigestPerformanceRow {
  id:               string;
  client_id:        string;
  owner_user_id:    string;
  campaign_item_id: string | null;
  artifact_id:      string | null;
  metrics:          Record<string, unknown>;  // rendered VERBATIM per key whitelist
  verdict:          PerformanceVerdict | null;
  period_start:     string | null;
  period_end:       string | null;
  created_at:       string;
}

/**
 * Minimal campaign_items projection — ONLY the item→campaign linkage the
 * results section needs to attribute a content_performance row (keyed by
 * campaign_item_id) to its campaign, so "awaiting data" honesty can be stated
 * per campaign. Loaded with one query (no N+1).
 */
export interface DigestItemRef {
  id:          string;
  campaign_id: string;
}

/**
 * A pending approval the digest asks the owner about (§1.4 — the approve-tap
 * IS the engagement loop). Kept generic: the heartbeat/autonomy layer supplies
 * these; the digest only narrates them. `ref` is the id of the object the
 * approval acts on (campaign id / proposal id).
 */
export interface ApprovalRequest {
  kind:      string;
  rationale: string;
  ref:       string;
}

// ── compose inputs ─────────────────────────────────────────────────────────────

export interface DigestPeriod {
  kind:  DigestKind;
  start: string;   // YYYY-MM-DD, inclusive
  end:   string;   // YYYY-MM-DD, inclusive
}

/** Everything composeDigest reads. All rows are recorded DB rows — no free text. */
export interface DigestInputs {
  period:      DigestPeriod;
  campaigns:   Campaign[];
  decisions:   CampaignDecision[];
  items:       DigestItemRef[];
  diagnoses:   DigestDiagnosisRow[];
  hypotheses:  { resolved: HypothesisRow[]; open: HypothesisRow[] };
  performance: DigestPerformanceRow[];
  insights:    ClientInsight[];   // ACTIVE atoms — confidence citations by grounded_in lookup
  approvalsNeeded: ApprovalRequest[];
}

// ── digest content (persisted into digests.content jsonb) ─────────────────────

/**
 * A grounding citation read from an atom. `confidence` is null when the
 * grounded_in id no longer resolves to an active atom — we cite that the
 * decision WAS grounded but never invent a confidence (§1.3).
 */
export interface GroundingCitation {
  insight_id: string;
  content:    string | null;
  confidence: number | null;
}

/** A non-angle decision narrated under its campaign (rationale verbatim). */
export interface WhatRanDecision {
  decision_id:   string;
  decision_type: string;
  rationale:     string;
}

export interface WhatRanItem {
  campaign_id:       string;
  name:              string;
  channel:           string;
  status:            string;
  funnel_stage:      string | null;
  daily_budget:      number | null;
  dry_run:           boolean;
  rationale:         string | null;         // campaigns.rationale verbatim
  angle:             string | null;         // from the 'angle' decision row's decision jsonb
  angle_decision_id: string | null;
  grounding:         GroundingCitation[];
  other_decisions:   WhatRanDecision[];
}

/** One content_performance row's contribution — metric values VERBATIM. */
export interface ResultEntry {
  performance_id: string;
  verdict:        PerformanceVerdict | null;
  metrics:        Record<string, number>;
}

export interface ResultItem {
  campaign_id:   string;
  campaign_name: string;
  entries:       ResultEntry[];
}

/** A campaign that ran but has no performance rows yet — stated honestly. */
export interface AwaitingItem {
  campaign_id:   string;
  campaign_name: string;
}

export interface LearnedDiagnosis {
  diagnosis_id:  string;
  campaign_id:   string | null;
  campaign_name: string | null;
  failed_link:   DigestFailedLink;
  rationale:     string;   // VERBATIM from the diagnoses row
}

export type ResolvedHypothesisStatus = 'supported' | 'refuted' | 'inconclusive' | 'killed';

export interface LearnedHypothesis {
  hypothesis_id:  string;
  claim:          string;
  status:         ResolvedHypothesisStatus;
  verdict_reason: string | null;   // resolution.verdict_reason verbatim
}

export interface NextHypothesis {
  hypothesis_id: string;
  claim:         string;
  max_days:      number | null;    // horizon, read from the row
  max_spend:     number | null;
}

/** A 'precedents' decision row narrated as an episodic-memory note. */
export interface NextPrecedent {
  decision_id: string;
  rationale:   string;
}

export interface DigestSections {
  what_ran: WhatRanItem[];
  results:  { measured: ResultItem[]; awaiting: AwaitingItem[] };
  learned:  { diagnoses: LearnedDiagnosis[]; resolved_hypotheses: LearnedHypothesis[] };
  next:     { open_hypotheses: NextHypothesis[]; precedent_notes: NextPrecedent[] };
  approvals_needed: ApprovalRequest[];
}

export interface DigestStats {
  campaigns:           number;
  decisions:           number;
  diagnoses:           number;
  hypotheses_resolved: number;
  hypotheses_open:     number;
  performance_rows:    number;
  warnings:            string[];
}

export interface DigestContent {
  period:   DigestPeriod;
  sections: DigestSections;
  stats:    DigestStats;
}

// ── compose output ─────────────────────────────────────────────────────────────

export interface ComposeResult {
  content:       DigestContent;
  rendered_text: string;
  /** EXACTLY the ids of the rows that contributed a clause (the audit trail). */
  sources:       DigestSources;
  warnings:      string[];
}
