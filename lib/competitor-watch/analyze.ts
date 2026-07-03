// lib/competitor-watch/analyze.ts
//
// PURE analysis over stored competitor rows — no I/O, no LLM. This file IS
// the intelligence of C-09: the longevity method (skill §2), the §3
// angle-coverage map with its decision logic, the strategic flags the planner
// consumes (§6.3), and the §6.1 delta report. Everything takes `now`
// explicitly so tests pin time exactly.

import type { CompetitorAdRow, CompetitorEntityRow } from '@/lib/capability-contracts';
import {
  KNOWN_ANGLES,
  isCompetitorAngle,
  type CoverageAngle,
  type CoverageCell,
  type CoverageMap,
  type CoverageWeight,
  type DeltaAdRef,
  type MarketWeight,
  type OwnAngle,
  type StrategicFlag,
  type WatchDelta,
} from './types';

// ── thresholds (exported WITH the why — skill §2) ─────────────────────────────

/**
 * VETERAN: an ACTIVE ad aged ≥ 56 days (8 weeks). Skill §2: "an ad running 3+
 * months is almost certainly paying for itself — nobody funds a loser for a
 * quarter"; the 8-week floor of the skill's 8–12w veteran band is the
 * earliest point where longevity ≈ profitability is a safe inference. A
 * veteran's decoded angle is a market-VALIDATED angle.
 */
export const VETERAN_MIN_AGE_DAYS = 56;

/**
 * CHURNED: an INACTIVE ad whose whole lifespan was ≤ 28 days (skill §2.3:
 * "appeared and vanished within ~2–4 weeks = failed tests"). A churned angle
 * is market evidence of a hard sell — tried-and-dropped.
 */
export const CHURN_MAX_LIFESPAN_DAYS = 28;

/**
 * FRESH: an active ad younger than 14 days — too new to infer anything from;
 * it counts as light presence on the map but is called out separately so the
 * delta reader knows "new push" from "steady state".
 */
export const FRESH_MAX_AGE_DAYS = 14;

/** BURST: ≥ 3 previously-unseen ads from one entity in a single watch — a
 *  push (new offer, funding, season; skill §2.4). */
export const BURST_MIN_NEW_ADS = 3;

/**
 * An own angle atom "supports" an open lane when its confidence is at least
 * the lifecycle baseline (0.50 = CONFIDENCE.START in lib/intelligence): a
 * below-baseline atom is a weakened belief, not support for a strategic bet
 * (skill §3: "supporting customer atom … with decent confidence").
 */
export const SUPPORTING_ATOM_MIN_CONFIDENCE = 0.5;

// ── classification (the longevity method) ─────────────────────────────────────

export type AdLongevityClass = 'veteran' | 'churned' | 'fresh' | 'standard';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from a YYYY-MM-DD date string to `now` (UTC; negative clamped 0). */
const daysSince = (dateStr: string, now: Date): number => {
  const t = Date.parse(dateStr);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
};

/** Whole days between two YYYY-MM-DD date strings (the ad's lifespan). */
const daysBetween = (fromStr: string, toStr: string): number => {
  const from = Date.parse(fromStr);
  const to   = Date.parse(toStr);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
};

/**
 * Classify one ad by longevity:
 *  • veteran  — active AND age ≥ VETERAN_MIN_AGE_DAYS (paying for itself)
 *  • churned  — inactive AND lifespan ≤ CHURN_MAX_LIFESPAN_DAYS (tried-and-dropped)
 *  • fresh    — active AND age < FRESH_MAX_AGE_DAYS (too new to judge)
 *  • standard — everything else (mid-age active ads; long-lived retired ads —
 *    a completed run is NOT churn)
 */
export function classifyAd(ad: CompetitorAdRow, now: Date): AdLongevityClass {
  if (ad.active) {
    const age = daysSince(ad.first_seen, now);
    if (age >= VETERAN_MIN_AGE_DAYS) return 'veteran';
    if (age < FRESH_MAX_AGE_DAYS) return 'fresh';
    return 'standard';
  }
  return daysBetween(ad.first_seen, ad.last_seen) <= CHURN_MAX_LIFESPAN_DAYS ? 'churned' : 'standard';
}

export interface ClassifiedAds {
  veterans: CompetitorAdRow[];
  churned:  CompetitorAdRow[];
  fresh:    CompetitorAdRow[];
  standard: CompetitorAdRow[];
}

export function classifyAds(ads: CompetitorAdRow[], now: Date): ClassifiedAds {
  const out: ClassifiedAds = { veterans: [], churned: [], fresh: [], standard: [] };
  for (const ad of ads) {
    const cls = classifyAd(ad, now);
    if (cls === 'veteran') out.veterans.push(ad);
    else if (cls === 'churned') out.churned.push(ad);
    else if (cls === 'fresh') out.fresh.push(ad);
    else out.standard.push(ad);
  }
  return out;
}

// ── the §3 coverage map ───────────────────────────────────────────────────────

/** The decoded angle of an ad, when present and taxonomy-valid. */
const adAngle = (ad: CompetitorAdRow): string | null => {
  const a = ad.decoded?.angle;
  return isCompetitorAngle(a) ? a : null;
};

/** Deterministic map ordering: taxonomy order first, then other: labels. */
const angleOrder = (angle: string): number => {
  const i = KNOWN_ANGLES.findIndex((a) => a === angle);
  return i === -1 ? KNOWN_ANGLES.length : i;
};

/**
 * Assemble the angle-coverage map (skill §3): rows = every angle observed in
 * the market (decoded ads, including churned attempts) plus the client's own
 * angles; columns = tracked entities; cells = how hard each entity runs the
 * angle. Market weight per lane:
 *   ≥2 entities heavy → saturated · 1 heavy → contested ·
 *   only light presence → thin · no active presence → open
 * where heavy = has a VETERAN ad on the angle (market-validated) and light =
 * active-but-unproven ads only. Churned ads carry NO active weight — they
 * feed `churned_entity_ids` (and open-lane churn_evidence) instead.
 *
 * Decision-logic annotations (skill §3):
 *   • own angles get {contested} — ≥1 heavy competitor in the lane.
 *   • open lanes get {has_supporting_atom, churn_evidence}.
 */
export function buildCoverageMap(
  entities:  CompetitorEntityRow[],
  ads:       CompetitorAdRow[],
  ownAngles: OwnAngle[],
  now:       Date,
): CoverageMap {
  const entityIds = new Set(entities.map((e) => e.id));
  const scoped = ads.filter((ad) => entityIds.has(ad.entity_id));

  // Collect every angle present anywhere: decoded ads (active AND churned
  // attempts) + the client's own angles.
  const angleSet = new Set<string>();
  for (const ad of scoped) {
    const a = adAngle(ad);
    if (a) angleSet.add(a);
  }
  for (const own of ownAngles) angleSet.add(own.angle);

  const ownByAngle = new Map<string, OwnAngle>();
  for (const own of ownAngles) if (!ownByAngle.has(own.angle)) ownByAngle.set(own.angle, own);

  const angles: CoverageAngle[] = [];
  for (const angle of angleSet) {
    const cells: CoverageCell[] = [];
    const churnedEntityIds: string[] = [];
    let heavy = 0;
    let light = 0;

    for (const entity of entities) {
      const entityAds = scoped.filter((ad) => ad.entity_id === entity.id && adAngle(ad) === angle);
      let weight: CoverageWeight = 'none';
      let hasChurn = false;
      for (const ad of entityAds) {
        const cls = classifyAd(ad, now);
        if (cls === 'veteran') weight = 'heavy';
        else if (ad.active && weight !== 'heavy') weight = 'light';
        else if (cls === 'churned') hasChurn = true;
      }
      if (weight === 'heavy') heavy++;
      if (weight === 'light') light++;
      if (hasChurn) churnedEntityIds.push(entity.id);
      cells.push({ entity_id: entity.id, weight });
    }

    const market_weight: MarketWeight =
      heavy >= 2 ? 'saturated'
      : heavy === 1 ? 'contested'
      : light >= 1 ? 'thin'
      : 'open';

    const own = ownByAngle.get(angle);
    const entry: CoverageAngle = {
      angle,
      cells,
      market_weight,
      churned_entity_ids: churnedEntityIds,
      ...(own !== undefined
        ? {
            own: {
              atom_confidence: own.atomConfidence ?? null,
              contested:       heavy >= 1,
              ...(own.insightId !== undefined ? { insight_id: own.insightId } : {}),
            },
          }
        : {}),
      ...(market_weight === 'open'
        ? {
            open_lane: {
              has_supporting_atom:
                own !== undefined &&
                (own.atomConfidence ?? SUPPORTING_ATOM_MIN_CONFIDENCE) >= SUPPORTING_ATOM_MIN_CONFIDENCE,
              churn_evidence: churnedEntityIds.length > 0,
            },
          }
        : {}),
    };
    angles.push(entry);
  }

  angles.sort((a, b) => angleOrder(a.angle) - angleOrder(b.angle) || a.angle.localeCompare(b.angle));
  return { angles };
}

// ── strategic flags (skill §3 decision logic → §6.3 planner contract) ─────────

const entityNames = (ids: string[], entities: CompetitorEntityRow[]): string =>
  ids.map((id) => entities.find((e) => e.id === id)?.name ?? id).join(', ');

/**
 * Derive the planner's flags from the annotated map. Each flag carries a
 * Hebrew rationale CITING THE EVIDENCE (which entities, which atom, churn) —
 * the planner must be able to argue the move, not just receive a verdict.
 *
 *  • open_lane_priority   — open + supporting atom: "the highest-value
 *    strategic bet available. Prioritize it." (§3)
 *  • open_lane_hypothesis — open, no atom: "either untapped or empty because
 *    it doesn't work — test small"; churn evidence lowers the prior further.
 *  • saturated_warning    — the client's own angle sits in a saturated lane:
 *    "paying premium CPMs to be ignored" unless structurally better.
 *  • churn_warning        — the client holds an angle competitors tried and
 *    dropped (in any lane): the market already paid to learn it's hard.
 */
export function strategicFlags(
  map:      CoverageMap,
  entities: CompetitorEntityRow[] = [],
): StrategicFlag[] {
  const flags: StrategicFlag[] = [];

  for (const lane of map.angles) {
    const heavyIds = lane.cells.filter((c) => c.weight === 'heavy').map((c) => c.entity_id);

    if (lane.market_weight === 'open' && lane.open_lane) {
      if (lane.open_lane.has_supporting_atom && lane.own) {
        const churnNote = lane.open_lane.churn_evidence
          ? ` זהירות: ${entityNames(lane.churned_entity_ids, entities)} ניסו את הזווית ונטשו — לרדת ברמת הביטחון ולתקף מהר.`
          : '';
        flags.push({
          kind:            'open_lane_priority',
          angle:           lane.angle,
          rationale:
            `נתיב פתוח: אף מתחרה במעקב לא מריץ את זווית '${lane.angle}', ` +
            `ויש אטום לקוח תומך (ביטחון ${lane.own.atom_confidence ?? '—'}). ` +
            `לפי הקרפט (§3) זהו ההימור האסטרטגי בעל הערך הגבוה ביותר — לתעדף.${churnNote}`,
          entity_ids:      lane.churned_entity_ids,
          atom_confidence: lane.own.atom_confidence ?? null,
        });
      } else {
        const churnNote = lane.open_lane.churn_evidence
          ? ` בנוסף, ${entityNames(lane.churned_entity_ids, entities)} כבר ניסו-ונטשו את הזווית — עדות שוק לקושי, ה-prior יורד עוד (§2.3).`
          : '';
        flags.push({
          kind:            'open_lane_hypothesis',
          angle:           lane.angle,
          rationale:
            `נתיב פתוח ללא אטום לקוח תומך: זווית '${lane.angle}' לא רצה אצל אף מתחרה — ` +
            `או הזדמנות לא-מנוצלת או נתיב ריק כי הוא לא עובד. היפותזה בעדיפות נמוכה: לבדוק בקטן לפני הימור פוזיציוני (§3).${churnNote}`,
          entity_ids:      lane.churned_entity_ids,
          atom_confidence: lane.own?.atom_confidence ?? null,
        });
      }
    }

    if (lane.own && lane.market_weight === 'saturated') {
      flags.push({
        kind:            'saturated_warning',
        angle:           lane.angle,
        rationale:
          `הזווית שלנו '${lane.angle}' יושבת בנתיב רווי: ל-${entityNames(heavyIds, entities)} ` +
          `מודעות ותיקות (8+ שבועות) על אותה זווית — השוק כבר שילם לוודא אותה, והתחרות שם יקרה. ` +
          `להיכנס רק עם הצעה או הוכחה טובה מבנית, אחרת משלמים CPM פרימיום כדי להיות מותעלמים (§3).`,
        entity_ids:      heavyIds,
        atom_confidence: lane.own.atom_confidence ?? null,
      });
    }

    if (lane.own && lane.churned_entity_ids.length > 0) {
      flags.push({
        kind:            'churn_warning',
        angle:           lane.angle,
        rationale:
          `זווית '${lane.angle}' שאנחנו מחזיקים נוסתה-וננטשה על ידי ${entityNames(lane.churned_entity_ids, entities)} ` +
          `(מודעות שנעלמו תוך עד 4 שבועות) — עדות שוק למכירה קשה. להתייחס לכל תוכנית להריץ אותה כהיפותזה ב-prior נמוך (§2.3).`,
        entity_ids:      lane.churned_entity_ids,
        atom_confidence: lane.own.atom_confidence ?? null,
      });
    }
  }

  return flags;
}

// ── delta report (skill §6.1) ─────────────────────────────────────────────────

const adKey = (ad: CompetitorAdRow): string => `${ad.entity_id}::${ad.platform_ad_ref}`;

const toDeltaRef = (ad: CompetitorAdRow): DeltaAdRef => ({
  entity_id:       ad.entity_id,
  platform_ad_ref: ad.platform_ad_ref,
  angle:           adAngle(ad),
  text_excerpt:    typeof ad.creative.text === 'string' ? ad.creative.text.slice(0, 80) : '',
});

export interface ComputeDeltaOptions {
  now: Date;
  /** When the previous snapshot was taken. first_seen never changes, so a
   *  veteran TRANSITION (age crossing 56d between watches) is only visible by
   *  classifying the previous rows at their own observation time. Defaults to
   *  `now` (within-run delta: new refs / kills / bursts only). */
  prevNow?: Date;
}

/**
 * Compute the watch delta between two snapshots of the same client's ads:
 *  • new_veterans — veteran NOW but not veteran in the previous snapshot
 *    (aged into the threshold, newly observed already-old, or reactivated).
 *  • newly_killed — active before, inactive now.
 *  • bursts       — entities with ≥ BURST_MIN_NEW_ADS previously-unseen refs.
 *  • silences     — entities that had ≥1 active ad before and have ads but
 *    ZERO active now (budget off — skill §2.4).
 */
export function computeDelta(
  prevAds:    CompetitorAdRow[],
  currentAds: CompetitorAdRow[],
  opts:       ComputeDeltaOptions,
): WatchDelta {
  const prevNow = opts.prevNow ?? opts.now;
  const prevByKey = new Map(prevAds.map((ad) => [adKey(ad), ad]));

  const new_veterans: DeltaAdRef[] = [];
  const newly_killed: DeltaAdRef[] = [];
  const newRefsByEntity = new Map<string, number>();

  for (const ad of currentAds) {
    const prev = prevByKey.get(adKey(ad));

    if (classifyAd(ad, opts.now) === 'veteran' &&
        (prev === undefined || classifyAd(prev, prevNow) !== 'veteran')) {
      new_veterans.push(toDeltaRef(ad));
    }
    if (prev !== undefined && prev.active && !ad.active) {
      newly_killed.push(toDeltaRef(ad));
    }
    if (prev === undefined) {
      newRefsByEntity.set(ad.entity_id, (newRefsByEntity.get(ad.entity_id) ?? 0) + 1);
    }
  }

  const bursts: WatchDelta['bursts'] = [];
  for (const [entity_id, new_ads] of newRefsByEntity) {
    if (new_ads >= BURST_MIN_NEW_ADS) bursts.push({ entity_id, new_ads });
  }

  const silences: WatchDelta['silences'] = [];
  const entityIds = new Set(currentAds.map((ad) => ad.entity_id));
  for (const entity_id of entityIds) {
    const cur  = currentAds.filter((ad) => ad.entity_id === entity_id);
    const prev = prevAds.filter((ad) => ad.entity_id === entity_id);
    if (cur.length > 0 && cur.every((ad) => !ad.active) && prev.some((ad) => ad.active)) {
      silences.push({ entity_id });
    }
  }

  return { new_veterans, newly_killed, bursts, silences };
}
