// lib/competitor-watch/types.ts
//
// Internal vocabulary for C-09 competitor watch (MARKETING-CAPABILITIES-SPEC
// §C-09; craft source: .claude/skills/competitor-analysis).
//
// The DB row shapes (CompetitorEntityRow, CompetitorAdRow, CompetitorRing)
// live in lib/capability-contracts and are imported, never redefined — this
// file holds only the pipeline-internal shapes: what a fetcher observes, what
// the LLM decoder produces, the §3 angle-coverage map, the §6 delta report,
// and the strategic flags handed to the planner.

// ── angle taxonomy (skill §2.2 "tag each with the angle taxonomy") ────────────

/**
 * The documented angle taxonomy the decoder must choose from. These are the
 * ROWS of the §3 coverage map. `other:<label>` is the escape hatch — a real
 * market angle we did not anticipate is still data, but it must be labelled
 * (a bare "other" cell would be an unmappable row).
 */
export const KNOWN_ANGLES = [
  'price_deal',        // מחיר / מבצע / תשלומים
  'speed_convenience', // מהירות / נוחות / זמינות
  'authority_expert',  // סמכות / מומחיות / ותק
  'emotional_safety',  // ביטחון רגשי / בלי כאב / בלי לחץ
  'identity_belonging',// זהות / שייכות
  'proof_results',     // הוכחה / תוצאות / לפני-אחרי
  'urgency_scarcity',  // דחיפות / מחסור
] as const;

export type KnownAngle = (typeof KNOWN_ANGLES)[number];

/** A taxonomy angle, or a labelled out-of-taxonomy angle ('other:<label>'). */
export type CompetitorAngle = KnownAngle | `other:${string}`;

/** Runtime guard for CompetitorAngle (taxonomy member, or non-empty other:). */
export function isCompetitorAngle(v: unknown): v is CompetitorAngle {
  if (typeof v !== 'string') return false;
  if (KNOWN_ANGLES.some((a) => a === v)) return true;
  return v.startsWith('other:') && v.slice('other:'.length).trim().length > 0;
}

// ── awareness (Schwartz levels — the decoder's second dimension) ──────────────

export const AWARENESS_LEVELS = [
  'unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware',
] as const;

export type AwarenessLevel = (typeof AWARENESS_LEVELS)[number];

export function isAwarenessLevel(v: unknown): v is AwarenessLevel {
  return typeof v === 'string' && AWARENESS_LEVELS.some((a) => a === v);
}

// ── fetching (the isolation seam's data shapes) ───────────────────────────────

/**
 * One ad as a fetcher observed it, BEFORE storage. `ref` is the stable
 * platform ad id when the source has one; manual-paste ads get a deterministic
 * 'manual:<sha256-12>' ref derived from the normalized text (see fetcher.ts),
 * so re-pasting the same ad upserts instead of duplicating.
 *
 * `still_active` is the observation, not history: true = the source shows the
 * ad currently running. `first_seen` (YYYY-MM-DD) is the launch date when the
 * source exposes it (Ad Library shows start dates; a paste may include one).
 */
export interface RawObservedAd {
  ref?:        string;
  text:        string;
  format?:     string;
  platforms?:  string[];
  landing_url?: string;
  first_seen?: string;
  still_active: boolean;
}

/** What one fetch of one entity produced. Fetch FAILURES throw — run-watch
 *  isolates them per entity (skill §6: one broken source never kills the watch). */
export interface FetchResult {
  ads:    RawObservedAd[];
  source: 'manual_paste' | 'fixture' | 'ad_library';
  note?:  string;
}

// ── decoding ──────────────────────────────────────────────────────────────────

/** The decoder's verdict on one ad text (skill §2.2: angle, awareness, offer). */
export interface AngleDecoding {
  angle:      CompetitorAngle;
  awareness:  AwarenessLevel;
  offer:      string;
  confidence: number; // [0..1] — everything here is inference (skill §2 "what we can't see")
}

/** One decode item the parser refused, with the WHY (observability). */
export interface DecodeDrop {
  reason: 'not_an_object' | 'missing_id' | 'unknown_id' | 'duplicate_id'
        | 'invalid_angle' | 'invalid_awareness' | 'invalid_confidence' | 'invalid_offer';
  /** Short excerpt of the offending item (never full raw). */
  detail: string;
}

/**
 * Total result of parsing decoder output. ok:false means the OUTPUT SHAPE was
 * unusable (empty / not JSON / no items array) — a per-item problem never
 * fails the batch, it lands in `dropped`.
 */
export type DecodeBatchResult =
  | { ok: true; decoded: Record<string, AngleDecoding>; dropped: DecodeDrop[] }
  | { ok: false; error: string };

// ── the §3 angle-coverage map ─────────────────────────────────────────────────

/** How hard one entity leans on one angle. heavy = has a VETERAN ad there
 *  (market-validated); light = active but unproven ads only; none = absent. */
export type CoverageWeight = 'heavy' | 'light' | 'none';

/** Market weight per lane (skill §3): ≥2 heavy = saturated, 1 heavy =
 *  contested, only-light presence = thin, no active presence = open. */
export type MarketWeight = 'saturated' | 'contested' | 'thin' | 'open';

export interface CoverageCell {
  entity_id: string;
  weight:    CoverageWeight;
}

export interface CoverageAngle {
  angle:         string; // CompetitorAngle; kept as string so free 'other:' labels round-trip
  cells:         CoverageCell[]; // one per tracked entity (the map's columns)
  market_weight: MarketWeight;
  /** Entities that tried-and-dropped this angle (churned ads) — skill §2.3:
   *  repeated attempt-and-drop is market evidence of a hard sell. */
  churned_entity_ids: string[];
  /** Present when the CLIENT runs/holds this angle (an own angle atom).
   *  `contested` = at least one competitor has a market-validated (heavy)
   *  presence in the lane — the value stamped onto the atom's structured. */
  own?: {
    atom_confidence: number | null;
    contested:       boolean;
    insight_id?:     string;
  };
  /** Present only when market_weight === 'open' — the §3 decision inputs:
   *  open + supporting atom = priority bet; open + no atom = low-prior
   *  hypothesis; churn evidence lowers the prior further. */
  open_lane?: {
    has_supporting_atom: boolean;
    churn_evidence:      boolean;
  };
}

export interface CoverageMap {
  angles: CoverageAngle[];
}

/** One of the client's own angle atoms, projected into taxonomy space.
 *  `insightId` lets emitAtomActions stamp structured.contested back on it. */
export interface OwnAngle {
  angle:           CompetitorAngle;
  atomConfidence?: number;
  insightId?:      string;
}

// ── delta report (skill §6.1) ─────────────────────────────────────────────────

export interface DeltaAdRef {
  entity_id:       string;
  platform_ad_ref: string;
  angle:           string | null;
  text_excerpt:    string;
}

export interface WatchDelta {
  /** Ads that crossed the veteran threshold since the previous snapshot —
   *  newly market-validated angles. */
  new_veterans: DeltaAdRef[];
  /** Ads active in the previous snapshot, inactive now (killed campaigns). */
  newly_killed: DeltaAdRef[];
  /** Entities that launched ≥ BURST_MIN_NEW_ADS new ads — a push (skill §2.4). */
  bursts: Array<{ entity_id: string; new_ads: number }>;
  /** Entities that went from ≥1 active ad to ALL inactive — budget off
   *  (opportunity: cheaper auctions, orphaned demand — skill §2.4). */
  silences: Array<{ entity_id: string }>;
}

// ── strategic flags (skill §3 decision logic + §6.3) ──────────────────────────

export type StrategicFlagKind =
  | 'open_lane_priority'    // open lane + supporting atom → highest-value bet
  | 'open_lane_hypothesis'  // open lane, no atom → test small first
  | 'saturated_warning'     // own running angle sits in a saturated lane
  | 'churn_warning';        // own angle that competitors tried-and-dropped

export interface StrategicFlag {
  kind:            StrategicFlagKind;
  angle:           string;
  /** Hebrew rationale citing the evidence — this is what the planner reads. */
  rationale:       string;
  entity_ids:      string[];
  atom_confidence: number | null;
}

// ── run results ───────────────────────────────────────────────────────────────

export type WatchStage = 'fetch' | 'upsert' | 'decode' | 'emit';

/** A stage failure, isolated: partial progress before it is preserved. */
export interface WatchError {
  stage:      WatchStage;
  entity_id?: string;
  error:      string;
}

/** One atom mutation the watch performed (the §6.2 atom-actions ledger). */
export interface AtomAction {
  action:     'created' | 'updated' | 'flagged';
  insight_id: string;
  entity_id?: string;
  angle?:     string;
  reason:     string;
}

export interface RunWatchResult {
  delta:          WatchDelta;
  map:            CoverageMap;
  flags:          StrategicFlag[];
  atomActions:    AtomAction[];
  errors:         WatchError[];
  decoded_count:  number;
  decode_dropped: DecodeDrop[];
}
