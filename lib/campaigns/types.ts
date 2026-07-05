// lib/campaigns/types.ts
//
// T2 Campaign domain model. PURE types that mirror migration 030_ai_marketer.sql
// (campaigns / campaign_items / campaign_decisions). These are the rows the
// "AI marketer" assembles and records on behalf of the user — every one carries
// `grounded_in` (the client_insights atoms a decision drew from) + a plain-language
// `rationale`, so the WHY behind a campaign is always auditable.
//
// No DB / network here — the runner (runner.ts) and store (store.ts) consume
// these shapes; the API layer (app/api/campaigns) serializes them.

// ── enums (mirror the CHECK constraints in migration 030) ──────────────────────

/** Where the campaign runs. (`whatsapp` is owned by T6; T2 assembles meta_*.) */
export type CampaignChannel = 'meta_paid' | 'meta_organic' | 'whatsapp';

/** Lifecycle of a managed campaign (see state.ts for the legal transitions). */
export type CampaignStatus =
  | 'draft'
  | 'planned'
  | 'generating'
  | 'assembled'
  | 'scheduled'
  | 'publishing'
  | 'live'
  | 'paused'
  | 'completed'
  | 'failed';

/** Marketing objective stored on the campaign row (db vocabulary). */
export type CampaignObjectiveDb =
  | 'awareness'
  | 'traffic'
  | 'leads'
  | 'conversions'
  | 'engagement'
  | 'messages';

/** Funnel stage, mirrored from the decision engine. */
export type CampaignFunnelStage = 'TOFU' | 'MOFU' | 'BOFU';

/** Concrete piece inside a campaign. */
export type CampaignItemType = 'ad' | 'post' | 'adset' | 'creative' | 'message';

/** Lifecycle of a single item. */
export type CampaignItemStatus =
  | 'draft'
  | 'assembled'
  | 'scheduled'
  | 'published'
  | 'paused'
  | 'failed'
  | 'superseded';

/** The kind of decision recorded in the grounded decision log. */
export type CampaignDecisionType =
  | 'angle'
  | 'audience'
  | 'platform'
  | 'budget'
  | 'objective'
  | 'funnel'
  | 'channel'
  // W2 wire-in: the episodic precedents that informed this run (C-02). The DB
  // column has no CHECK on decision_type; this union is the source of truth.
  | 'precedents'
  // Quick-campaign wire-in: the copy framework(s) chosen for the generated
  // variants (e.g. PAS/AIDA/BAB). Same no-CHECK column; union stays the truth.
  | 'framework';

// ── row shapes ─────────────────────────────────────────────────────────────────

/** A `public.campaigns` row. */
export interface Campaign {
  id:                string;
  client_id:         string;
  owner_user_id:     string;
  name:              string;
  objective:         CampaignObjectiveDb | null;
  channel:           CampaignChannel;
  status:            CampaignStatus;
  daily_budget:      number | null;          // account currency (major units), null for organic
  funnel_stage:      CampaignFunnelStage | null;
  meta_campaign_id:  string | null;          // Meta Ads campaign id once created (dryrun_* in dry-run)
  dry_run:           boolean;
  grounded_in:       string[];               // client_insights atoms behind the campaign
  rationale:         string | null;
  created_at?:       string;
  updated_at?:       string;
}

/** A `public.campaign_items` row. */
export interface CampaignItem {
  id:              string;
  campaign_id:     string;
  client_id:       string;
  owner_user_id:   string;
  artifact_id:     string | null;
  item_type:       CampaignItemType;
  status:          CampaignItemStatus;
  meta_object_id:  string | null;            // adset/ad/creative/post id on Meta (dryrun_* in dry-run)
  targeting_spec:  Record<string, unknown>;  // Meta targeting object derived from insights (T3 shape)
  ab_parent_id:    string | null;
  grounded_in:     string[];
  rationale:       string | null;
  created_at?:     string;
  updated_at?:     string;
}

/** A `public.campaign_decisions` row (the moat made auditable). */
export interface CampaignDecision {
  id:             string;
  campaign_id:    string | null;
  client_id:      string;
  owner_user_id:  string;
  decision_type:  CampaignDecisionType;
  decision:       Record<string, unknown>;   // the chosen value (targeting / budget split / objective …)
  grounded_in:    string[];
  rationale:      string;
  created_at?:    string;
}

// ── insert inputs (what the runner hands the store; ids/timestamps DB-assigned) ──

export interface CampaignInsert {
  client_id:        string;
  owner_user_id:    string;
  name:             string;
  objective:        CampaignObjectiveDb | null;
  channel:          CampaignChannel;
  status:           CampaignStatus;
  daily_budget:     number | null;
  funnel_stage:     CampaignFunnelStage | null;
  meta_campaign_id: string | null;
  dry_run:          boolean;
  grounded_in:      string[];
  rationale:        string | null;
}

export interface CampaignItemInsert {
  campaign_id:    string;
  client_id:      string;
  owner_user_id:  string;
  artifact_id:    string | null;
  item_type:      CampaignItemType;
  status:         CampaignItemStatus;
  meta_object_id: string | null;
  targeting_spec: Record<string, unknown>;
  ab_parent_id?:  string | null;
  grounded_in:    string[];
  rationale:      string | null;
}

export interface CampaignDecisionInsert {
  campaign_id:   string | null;
  client_id:     string;
  owner_user_id: string;
  decision_type: CampaignDecisionType;
  decision:      Record<string, unknown>;
  grounded_in:   string[];
  rationale:     string;
}
