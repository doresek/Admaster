// lib/campaigns/targeting-map.ts
//
// The bridge between the DECISION ENGINE's output and the META ADS client's
// input. PURE functions — no DB / network.
//
//   mapTargeting(spec)   decision TargetingSpec → Meta Ads TargetingSpec
//   mapObjective(obj)    decision objective string → Meta objective + db verb + goals
//   ilsToAgorot(major)   account-currency major units → Graph MINOR units
//
// CONTRACT NOTES (reconciled here; flagged in the task report):
//  • genders: the engine emits 'all' | 'male' | 'female'; Graph wants a numeric
//    array (1 = male, 2 = female) and OMITS the field for "all".
//  • geo: the engine emits one free-text geo string. We map a 2-letter value to
//    an ISO country (geo_locations.countries). A city/region name CANNOT be
//    turned into a Graph geo key without a live targeting-search lookup, so we
//    fall back to country 'IL' and record the unresolved gap (see `notes`).
//  • interests: the engine emits SEED PHRASES, not Meta interest ids. Graph
//    interest nodes ideally carry an `id`; we pass `{ name }` only. Resolving
//    names → ids needs a live `/search?type=adinterest` call (T8/live wiring),
//    so every interest here is an UNRESOLVED id — surfaced in `notes`.
//  • custom_audience_hint / lookalike_hint: prose strategy hints, NOT audience
//    ids. They cannot be placed on the Graph targeting object (which needs real
//    audience ids), so they are carried in `notes` for the live wiring to resolve.
//  • budget: the engine emits a daily budget in ACCOUNT-CURRENCY MAJOR units
//    (e.g. ₪80); the Ads client's `dailyBudget` is in MINOR units (agorot/cents).

import type {
  TargetingSpec as DecisionTargetingSpec,
  Genders as DecisionGenders,
} from '@/lib/decision-engine';
import type {
  TargetingSpec as MetaTargetingSpec,
  Gender as MetaGender,
  CampaignObjective as MetaCampaignObjective,
  OptimizationGoal,
  BillingEvent,
} from '@/lib/meta-ads';
import type { CampaignObjectiveDb } from './types';

/** Engine gender vocabulary → Graph numeric genders. 'all' ⇒ omit the field. */
export function mapGenders(g: DecisionGenders): MetaGender[] | undefined {
  if (g === 'male') return [1];
  if (g === 'female') return [2];
  return undefined; // 'all' — omit so Graph targets every gender
}

/** ISO-3166 alpha-2 country code? (e.g. "IL", "us"). */
function isCountryCode(geo: string): boolean {
  return /^[A-Za-z]{2}$/.test(geo.trim());
}

/** Account-currency MAJOR units → Graph MINOR units (agorot / cents), integer. */
export function ilsToAgorot(major: number): number {
  return Math.round((Number.isFinite(major) ? major : 0) * 100);
}

/** The result of mapping the decision targeting, with any unresolved-id notes. */
export interface MappedTargeting {
  targeting: MetaTargetingSpec;
  /** Plain-language gaps a live (T8) mapper must still resolve. */
  notes: string[];
}

/**
 * Map the decision engine's TargetingSpec to the Meta Ads client's targeting
 * input. Interests are passed as `{ name }` (ids unresolved); audience hints are
 * not mapped onto the spec (they need real ids) but recorded in `notes`.
 */
export function mapTargeting(spec: DecisionTargetingSpec): MappedTargeting {
  const notes: string[] = [];
  const targeting: MetaTargetingSpec = {};

  // ── geo ──────────────────────────────────────────────────────────────────
  const geo = (spec.geo ?? '').trim();
  if (geo && isCountryCode(geo)) {
    targeting.geo_locations = { countries: [geo.toUpperCase()] };
  } else {
    targeting.geo_locations = { countries: ['IL'] };
    if (geo) {
      notes.push(
        `geo "${geo}" is not a country code; defaulted to country IL — a Graph ` +
          `region/city key requires a live targeting-search lookup (unresolved).`,
      );
    }
  }

  // ── age + genders ──────────────────────────────────────────────────────────
  if (typeof spec.age_min === 'number') targeting.age_min = spec.age_min;
  if (typeof spec.age_max === 'number') targeting.age_max = spec.age_max;
  const genders = mapGenders(spec.genders);
  if (genders) targeting.genders = genders;

  // ── interests (seed phrases → { name } only; ids unresolved) ────────────────
  const interests = (spec.interests ?? []).map((s) => s.trim()).filter(Boolean);
  if (interests.length) {
    // Graph's TargetingInterest requires an `id`; we only have names. Pass the
    // name and stamp a placeholder so the shape is valid and the gap is explicit.
    targeting.interests = interests.map((name) => ({ id: '', name }));
    notes.push(
      `${interests.length} interest seed phrase(s) passed as { name } with NO Meta ` +
        `interest id — needs a live /search?type=adinterest resolution (unresolved).`,
    );
  }

  // ── audience hints (NOT ids — cannot be placed on the Graph spec) ───────────
  if (spec.custom_audience_hint) {
    notes.push(
      `custom_audience_hint "${spec.custom_audience_hint}" is a strategy hint, not an ` +
        `audience id — build/resolve the custom audience in live wiring (unresolved).`,
    );
  }
  if (spec.lookalike_hint) {
    notes.push(
      `lookalike_hint "${spec.lookalike_hint}" is a strategy hint, not an audience id — ` +
        `create the lookalike from a source audience in live wiring (unresolved).`,
    );
  }

  return { targeting, notes };
}

/** The Meta-ad shape a decision objective resolves to. */
export interface MappedObjective {
  metaObjective:    MetaCampaignObjective; // OUTCOME_* for the Ads campaign
  dbObjective:      CampaignObjectiveDb;   // verb stored on the campaigns row
  optimizationGoal: OptimizationGoal;      // ad set optimization
  billingEvent:     BillingEvent;          // ad set billing event
}

const OBJECTIVE_MAP: Record<string, MappedObjective> = {
  awareness:   { metaObjective: 'OUTCOME_AWARENESS',  dbObjective: 'awareness',   optimizationGoal: 'REACH',               billingEvent: 'IMPRESSIONS' },
  engagement:  { metaObjective: 'OUTCOME_ENGAGEMENT', dbObjective: 'engagement',  optimizationGoal: 'POST_ENGAGEMENT',     billingEvent: 'IMPRESSIONS' },
  traffic:     { metaObjective: 'OUTCOME_TRAFFIC',    dbObjective: 'traffic',     optimizationGoal: 'LINK_CLICKS',         billingEvent: 'IMPRESSIONS' },
  leads:       { metaObjective: 'OUTCOME_LEADS',      dbObjective: 'leads',       optimizationGoal: 'LEAD_GENERATION',     billingEvent: 'IMPRESSIONS' },
  conversions: { metaObjective: 'OUTCOME_SALES',      dbObjective: 'conversions', optimizationGoal: 'OFFSITE_CONVERSIONS', billingEvent: 'IMPRESSIONS' },
  sales:       { metaObjective: 'OUTCOME_SALES',      dbObjective: 'conversions', optimizationGoal: 'OFFSITE_CONVERSIONS', billingEvent: 'IMPRESSIONS' },
  messages:    { metaObjective: 'OUTCOME_ENGAGEMENT', dbObjective: 'messages',    optimizationGoal: 'POST_ENGAGEMENT',     billingEvent: 'IMPRESSIONS' },
};

const DEFAULT_OBJECTIVE: MappedObjective = OBJECTIVE_MAP.engagement;

/**
 * Map a decision-engine objective string (awareness | engagement | traffic |
 * conversions | sales | leads | messages) to the Meta objective + the db verb +
 * the ad-set optimization/billing pair. Unknown values fall back to engagement.
 */
export function mapObjective(objective: string | undefined): MappedObjective {
  if (!objective) return DEFAULT_OBJECTIVE;
  return OBJECTIVE_MAP[objective.trim().toLowerCase()] ?? DEFAULT_OBJECTIVE;
}

/** Map the decision platform to Graph publisher_platforms (undefined ⇒ auto). */
export function mapPublisherPlatforms(platform: string | undefined): string[] | undefined {
  if (platform === 'instagram') return ['instagram'];
  if (platform === 'facebook') return ['facebook'];
  return undefined; // whatsapp / unknown ⇒ leave to Advantage+ automatic placements
}
