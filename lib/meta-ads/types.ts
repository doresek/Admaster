// ════════════════════════════════════════════
// Meta Marketing (Ads) API — object model & payload types (T3).
//
// Pure type definitions for the typed Ads client. No runtime, no imports.
// The decision-engine (lib/decision-engine, NOT imported here) produces the
// TargetingSpec; we define a structurally-compatible input type locally and
// note it in the task report so the two can be reconciled.
// ════════════════════════════════════════════

// ── Status: every created object defaults to PAUSED. We never auto-activate. ──
export type AdObjectStatus = 'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';

// ── Campaign objectives (Outcome-Driven Ads Experience, ODAX). ──
// These are the canonical OUTCOME_* objectives used by Graph v17+.
export type CampaignObjective =
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_APP_PROMOTION'
  | 'OUTCOME_SALES';

// ── Ad set optimization & billing. ──
export type OptimizationGoal =
  | 'NONE'
  | 'IMPRESSIONS'
  | 'REACH'
  | 'LINK_CLICKS'
  | 'LANDING_PAGE_VIEWS'
  | 'POST_ENGAGEMENT'
  | 'PAGE_LIKES'
  | 'LEAD_GENERATION'
  | 'QUALITY_LEAD'
  | 'OFFSITE_CONVERSIONS'
  | 'VALUE'
  | 'THRUPLAY'
  | 'APP_INSTALLS';

export type BillingEvent =
  | 'IMPRESSIONS'
  | 'LINK_CLICKS'
  | 'POST_ENGAGEMENT'
  | 'PAGE_LIKES'
  | 'THRUPLAY'
  | 'APP_INSTALLS';

// ── Targeting spec ───────────────────────────────────────────────────────────
// Structurally compatible with the Graph `targeting` object. The decision
// engine emits this shape; reconcile its output against this type.

export interface GeoLocations {
  // ISO-3166 alpha-2 country codes, e.g. ['IL', 'US'].
  countries?: string[];
  // Region keys (Graph region ids).
  regions?: Array<{ key: string }>;
  // City keys with an optional radius.
  cities?: Array<{ key: string; radius?: number; distance_unit?: 'mile' | 'kilometer' }>;
  // Postal/zip code keys.
  zips?: Array<{ key: string }>;
  location_types?: Array<'home' | 'recent' | 'travel_in'>;
}

// A single interest / behaviour / demographic targeting node.
export interface TargetingInterest {
  id: string;
  name?: string;
}

// One "OR" group inside flexible_spec; multiple groups are AND-ed together.
export interface FlexibleSpec {
  interests?: TargetingInterest[];
  behaviors?: TargetingInterest[];
  demographics?: TargetingInterest[];
}

// genders: 1 = male, 2 = female (Graph convention). Omit for all.
export type Gender = 1 | 2;

export interface TargetingSpec {
  geo_locations?: GeoLocations;
  age_min?: number;
  age_max?: number;
  genders?: Gender[];
  // Convenience top-level interests (mapped into flexible_spec by callers that
  // prefer the flat shape). Both are accepted.
  interests?: TargetingInterest[];
  flexible_spec?: FlexibleSpec[];
  // Audience references — { id } objects per Graph.
  custom_audiences?: Array<{ id: string }>;
  excluded_custom_audiences?: Array<{ id: string }>;
  // Lookalike audiences are just custom audiences by id at targeting time;
  // kept as a distinct field for the decision engine's clarity.
  lookalike_audiences?: Array<{ id: string }>;
  // Platforms / placements (optional; omit for Advantage+ automatic placements).
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  locales?: number[];
}

// ── Call to action (used on creatives). ──
export type CallToActionType =
  | 'LEARN_MORE'
  | 'SHOP_NOW'
  | 'SIGN_UP'
  | 'BOOK_TRAVEL'
  | 'DOWNLOAD'
  | 'GET_OFFER'
  | 'CONTACT_US'
  | 'SUBSCRIBE'
  | 'APPLY_NOW'
  | 'GET_QUOTE'
  | 'MESSAGE_PAGE'
  | 'WHATSAPP_MESSAGE'
  | 'CALL_NOW'
  | 'NO_BUTTON';

export interface CallToAction {
  type: CallToActionType;
  // value.link is the destination for the CTA button; defaults to creative link.
  value?: { link?: string; link_caption?: string; app_link?: string };
}

// ── Custom / lookalike audience inputs ───────────────────────────────────────
export type CustomAudienceSubtype =
  | 'CUSTOM'
  | 'WEBSITE'
  | 'ENGAGEMENT'
  | 'LOOKALIKE'
  | 'APP'
  | 'OFFLINE_CONVERSION';

// ── Method inputs ────────────────────────────────────────────────────────────
export interface CreateCampaignInput {
  name: string;
  objective: CampaignObjective;
  status?: AdObjectStatus; // defaults to PAUSED
  // Optional Graph special-ad-categories (housing/credit/employment/etc).
  specialAdCategories?: string[];
  // Optional campaign-level budget (minor units / cents). When set, the ad set
  // must NOT carry its own budget (Graph CBO rule).
  dailyBudget?: number;
  lifetimeBudget?: number;
  bidStrategy?: BidStrategy;
}

export type BidStrategy =
  | 'LOWEST_COST_WITHOUT_CAP'
  | 'LOWEST_COST_WITH_BID_CAP'
  | 'COST_CAP'
  | 'LOWEST_COST_WITH_MIN_ROAS';

export interface CreateAdSetInput {
  campaignId: string;
  name: string;
  // Daily budget in MINOR currency units (cents/agorot), per Graph convention.
  dailyBudget?: number;
  lifetimeBudget?: number;
  targeting: TargetingSpec;
  optimizationGoal: OptimizationGoal;
  billingEvent: BillingEvent;
  status?: AdObjectStatus; // defaults to PAUSED
  bidStrategy?: BidStrategy;
  bidAmount?: number; // minor units; required for *_WITH_BID_CAP / COST_CAP
  // ISO 8601; lifetime-budget ad sets require an end time.
  startTime?: string;
  endTime?: string;
  // Optional Graph promoted_object (e.g. { page_id } / { pixel_id, custom_event_type }).
  promotedObject?: Record<string, unknown>;
}

export interface CreateAdCreativeInput {
  pageId: string;
  message: string;
  link: string;
  name?: string;
  // Provide exactly one image source. imageHash references an already-uploaded
  // image in the ad account's image library; imageUrl is a public URL.
  imageHash?: string;
  imageUrl?: string;
  // Optional Instagram actor id for IG placements.
  instagramActorId?: string;
  callToAction?: CallToAction;
  description?: string;
  caption?: string;
}

export interface CreateAdInput {
  adsetId: string;
  creativeId: string;
  name: string;
  status?: AdObjectStatus; // defaults to PAUSED
}

export interface CreateCustomAudienceInput {
  name: string;
  description?: string;
  subtype?: CustomAudienceSubtype;
  // For rule-based (WEBSITE/ENGAGEMENT) audiences.
  rule?: Record<string, unknown>;
  customerFileSource?: 'USER_PROVIDED_ONLY' | 'PARTNER_PROVIDED_ONLY' | 'BOTH_USER_AND_PARTNER_PROVIDED';
}

export interface CreateLookalikeAudienceInput {
  name: string;
  // The source custom audience this lookalike is modelled from.
  originAudienceId: string;
  // ISO country code(s) the lookalike targets.
  country: string;
  // Ratio 0.01–0.20 (1%–20%). starting_ratio optional for tiered lookalikes.
  ratio: number;
  startingRatio?: number;
  description?: string;
}

// ── Client config & call log ─────────────────────────────────────────────────
export interface MetaAdsClientConfig {
  accessToken: string;
  // With or without the "act_" prefix; the client normalises it.
  adAccountId: string;
  graphVersion?: string;
  dryRun?: boolean; // defaults to true
}

// One recorded would-be (or actual) Graph request.
export interface RecordedCall {
  method: 'POST';
  endpoint: string; // full URL the request targets
  // The body params as they would be form-encoded for Graph (objects/arrays
  // JSON-stringified, access_token omitted from the log for safety).
  params: Record<string, string>;
  dryRun: boolean;
}

// Uniform result returned by every create* method.
export interface CreateResult {
  id: string;
  dryRun: boolean;
}

// ── Graph error envelope ─────────────────────────────────────────────────────
export interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  fbtrace_id?: string;
}
