// lib/attention/load.ts
//
// C-06 attention scheduler — state assembly from the existing ledgers.
//
// Builds ClientAttentionState snapshots for the pure scorer (score.ts) from:
//   • hypotheses      (migration 034) — open hypotheses + decision weight
//   • insight_events  (migration 028) — staleness (last atom activity)
//   • client_insights (migration 028) — seasonality atoms → calendar proximity
//   • campaigns       (migration 030) — active-campaign count (context only)
//
// HARD REQUIREMENT — no N+1: the fleet may be hundreds of clients, so the
// owner-wide loader issues EXACTLY ONE query per table using
// .in('client_id', ids) and groups rows in memory. Adding a per-client query
// here is a regression; the tests count queries per table to enforce it.
//
// DB conventions follow lib/intelligence/insights.ts: the client is dependency-
// injected, every read is explicitly owner-scoped (correct under either the
// admin or a user client), and every supabase error is checked and thrown.

import type { SupabaseClient } from '@supabase/supabase-js';
import { HYPOTHESIS_COLUMNS, type HypothesisRow } from '@/lib/capability-contracts';
import type {
  CalendarProximity,
  ClientAttentionState,
  ErrorFlag,
  OpenHypothesisProgress,
} from './types';
import { DEFAULT_CADENCE_DAYS } from './score';

// ── The DB seam ───────────────────────────────────────────────────────────────
// A minimal structural slice of SupabaseClient — just the chains this module
// uses. Loaders accept `SupabaseClient | AttentionDb`: production passes the
// real client directly, tests pass a plain in-memory stub with zero casting.
// toAttentionDb below bridges the union onto the seam via a runtime-guarded
// narrowing (see its JSDoc for why a compile-time assignment is impossible).
//
// Two deliberate loosenings keep tsc out of postgrest's generic soup (either
// of the stricter forms trips TS2589 "type instantiation is excessively
// deep"):
//   • `then` is declared inline, NOT via `extends PromiseLike<...>`.
//   • `data` is `unknown`, not row-typed — which is also the honest type for
//     jsonb-bearing rows; this module narrows every row with runtime guards.

export interface AttentionQueryResult {
  data:  unknown;
  error: { message: string } | null;
}

export interface AttentionSelectBuilder {
  eq(column: string, value: string): AttentionSelectBuilder;
  in(column: string, values: readonly string[]): AttentionSelectBuilder;
  then<X>(onfulfilled: (response: AttentionQueryResult) => X | PromiseLike<X>): PromiseLike<X>;
}

/** The tables this module reads. `from` takes the literal union, not `string`:
 * comparing SupabaseClient.from against a plain-string signature re-triggers
 * the TS2589 blowup; the finite union compares cheaply. */
export type AttentionTable =
  | 'clients' | 'hypotheses' | 'insight_events' | 'client_insights' | 'campaigns';

export interface AttentionDb {
  from(table: AttentionTable): { select(columns: string): AttentionSelectBuilder };
}

function isAttentionDbLike(u: unknown): u is AttentionDb {
  return isRecord(u) && typeof u.from === 'function';
}

/**
 * Boundary adapter: treat a live SupabaseClient (or a test seam) as the
 * structural AttentionDb slice.
 *
 * WHY NARROWING INSTEAD OF ASSIGNMENT: tsc cannot compare
 * PostgrestFilterBuilder's self-referential generics against ANY structural
 * builder slice without blowing its instantiation depth (TS2589) — direct
 * assignment, method-level delegation, and PromiseLike-extending variants all
 * trip it (supabase-js v2 type pathology). So the bridge is a RUNTIME-guarded
 * type-predicate narrowing (zero casts): widen to unknown first (narrowing the
 * union directly would build a SupabaseClient & AttentionDb intersection and
 * re-trigger TS2589), then check the one thing the seam needs — a callable
 * `from`. The chain shapes (.select().eq()/.in()/awaited {data,error}) are
 * compatible by construction; every internal call site stays typed by the
 * seam, and rows are narrowed by the runtime guards below.
 */
export function toAttentionDb(db: SupabaseClient | AttentionDb): AttentionDb {
  const candidate: unknown = db;
  if (!isAttentionDbLike(candidate)) {
    throw new Error('[attention] supabase client does not expose from()');
  }
  return candidate;
}

// ── Tunables ──────────────────────────────────────────────────────────────────

/**
 * decisionWeight = max(1, insight_ids.length) × domain multiplier.
 *
 * WHY: insight_ids are the atoms the verdict will move — a direct count of the
 * downstream beliefs (and therefore decisions) the claim unblocks. The max(1,·)
 * floor exists because an open hypothesis always unblocks at least its own
 * verdict. Angle/audience/offer claims steer the strategy core, so they carry
 * a 1.5× multiplier. All of this is TUNABLE policy, not measurement — revisit
 * once calibration (C-03) tells us which domains actually pay.
 */
export const DOMAIN_DECISION_MULTIPLIER: Record<HypothesisRow['domain'], number> = {
  angle:    1.5,
  audience: 1.5,
  offer:    1.5,
  creative: 1.0,
  funnel:   1.0,
  timing:   1.0,
  channel:  1.0,
  other:    1.0,
};

/** Campaign states that count as "active" for the context field. */
export const ACTIVE_CAMPAIGN_STATUSES: readonly string[] = ['live', 'publishing', 'scheduled'];

export interface LoadStateOpts {
  /** Analysis cadence in days (staleness accrues past it). Default 7. */
  cadenceDays?: number;
  /**
   * hypothesis id → observed sampleProgress toward the floor. Injected by the
   * caller once the performance pipe exists; without it progress is UNKNOWN
   * and reported as 0 (a hypothesis with test_refs is running, but we cannot
   * see how far along it is, and inventing progress would corrupt the ranking).
   */
  observations?: Record<string, number>;
  /**
   * client id → pipeline error flags, injected by the caller (e.g. from
   * lib/meta-health readiness reports). See the TODO on errorStates below.
   */
  errorFlags?: Record<string, ErrorFlag[]>;
  /** Clock override for deterministic tests. Defaults to the real now. */
  now?: Date;
}

const MS_PER_DAY = 86_400_000;

// ── Row guards ────────────────────────────────────────────────────────────────
// The DB seam returns unknown[]; these narrow rows structurally instead of
// casting. Guards check the load-bearing scalar/array columns; jsonb payloads
// (prediction, floor_spec, ...) are trusted as written by our own data layer
// under the migrations' CHECK constraints.

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === 'object' && u !== null && !Array.isArray(u);
}

function isStringArray(u: unknown): u is string[] {
  return Array.isArray(u) && u.every((x) => typeof x === 'string');
}

const HYPOTHESIS_DOMAINS: ReadonlySet<string> = new Set(
  Object.keys(DOMAIN_DECISION_MULTIPLIER),
);

function isHypothesisRow(u: unknown): u is HypothesisRow {
  return (
    isRecord(u) &&
    typeof u.id === 'string' &&
    typeof u.client_id === 'string' &&
    typeof u.owner_user_id === 'string' &&
    typeof u.claim === 'string' &&
    typeof u.status === 'string' &&
    typeof u.domain === 'string' &&
    HYPOTHESIS_DOMAINS.has(u.domain) &&
    isStringArray(u.insight_ids) &&
    Array.isArray(u.test_refs)
  );
}

interface EventStamp { client_id: string; created_at: string }

function isEventStamp(u: unknown): u is EventStamp {
  return isRecord(u) && typeof u.client_id === 'string' && typeof u.created_at === 'string';
}

interface SeasonalityAtom {
  client_id:  string;
  content:    string;
  confidence: number;
  structured: Record<string, unknown> | null;
}

function isSeasonalityAtom(u: unknown): u is SeasonalityAtom {
  return (
    isRecord(u) &&
    typeof u.client_id === 'string' &&
    typeof u.content === 'string' &&
    typeof u.confidence === 'number' &&
    (u.structured === null || isRecord(u.structured))
  );
}

interface ClientIdRow { client_id: string }

function isClientIdRow(u: unknown): u is ClientIdRow {
  return isRecord(u) && typeof u.client_id === 'string';
}

// ── Seasonality → CalendarProximity ──────────────────────────────────────────

/**
 * Parse one seasonality atom's `structured` payload into a CalendarProximity.
 *
 * Accepted window shapes (israeli-market-timing §4):
 *   • { month_start: 1..12, month_end: 1..12 } — RECURRING yearly window.
 *     Rolled forward to its next occurrence (wrap across the year boundary is
 *     supported, e.g. month_start 12, month_end 1).
 *   • { iso_start: 'YYYY-MM-DD', iso_end: 'YYYY-MM-DD' } — one-shot window.
 *     Dropped once fully in the past (the opportunity is gone).
 *
 * decision_lag is read as DAYS (number). Anything malformed — missing window,
 * bad month numbers, unparseable dates — returns null and the atom is SKIPPED,
 * never thrown on: seasonality atoms are free-form jsonb written by several
 * paths, and one bad atom must not blind the scheduler to a whole client.
 */
export function parseSeasonalityAtom(atom: SeasonalityAtom, now: Date): CalendarProximity | null {
  if (atom.structured === null) return null;
  const win = atom.structured.window;
  if (!isRecord(win)) return null;

  const nowMs = now.getTime();
  let startMs: number;
  let endMs: number;

  const { month_start: ms, month_end: me } = win;
  const { iso_start: is, iso_end: ie } = win;

  if (typeof ms === 'number' && typeof me === 'number') {
    if (!Number.isInteger(ms) || !Number.isInteger(me) || ms < 1 || ms > 12 || me < 1 || me > 12) {
      return null;
    }
    const year = now.getUTCFullYear();
    // end is EXCLUSIVE (first ms of the month after month_end); wrap adds a year.
    const endYear = me < ms ? year + 1 : year;
    startMs = Date.UTC(year, ms - 1, 1);
    endMs   = Date.UTC(endYear, me, 1);
    if (endMs <= nowMs) {
      // This year's occurrence is over — the window recurs, so roll to next year.
      startMs = Date.UTC(year + 1, ms - 1, 1);
      endMs   = Date.UTC(endYear + 1, me, 1);
    }
  } else if (typeof is === 'string' && typeof ie === 'string') {
    startMs = Date.parse(is);
    endMs   = Date.parse(ie);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
    if (endMs <= nowMs) return null; // one-shot window fully in the past
  } else {
    return null;
  }

  const rawLag = atom.structured.decision_lag;
  const decisionLagDays =
    typeof rawLag === 'number' && Number.isFinite(rawLag) && rawLag > 0 ? rawLag : 0;

  const label = typeof win.label === 'string' && win.label !== '' ? win.label : atom.content;

  return {
    windowLabel:         label.length > 80 ? `${label.slice(0, 77)}...` : label,
    daysUntilWindow:     startMs <= nowMs ? 0 : Math.ceil((startMs - nowMs) / MS_PER_DAY),
    decisionLagDays,
    relevanceConfidence: Math.min(1, Math.max(0, atom.confidence)),
  };
}

// ── Loaders ───────────────────────────────────────────────────────────────────

/** Await a query, throw on error, return rows (never null/non-array). */
async function rows(q: AttentionSelectBuilder, what: string): Promise<unknown[]> {
  const { data, error } = await q;
  if (error) throw new Error(`[attention] ${what} query failed: ${error.message}`);
  return Array.isArray(data) ? data : [];
}

/**
 * Batch-load attention states for a set of clients — the single query plan
 * both public loaders share. One query per table, regardless of fleet size.
 */
async function loadStatesForClients(
  db:          AttentionDb,
  ownerUserId: string,
  clientIds:   string[],
  opts:        LoadStateOpts,
): Promise<ClientAttentionState[]> {
  if (clientIds.length === 0) return [];

  const now         = opts.now ?? new Date();
  const cadenceDays =
    opts.cadenceDays !== undefined && Number.isFinite(opts.cadenceDays) && opts.cadenceDays > 0
      ? opts.cadenceDays
      : DEFAULT_CADENCE_DAYS;

  // One batched query per table — the N+1 guard in the tests counts these.
  const [hypothesisRows, eventRows, seasonalityRows, campaignRows] = await Promise.all([
    rows(
      db.from('hypotheses').select(HYPOTHESIS_COLUMNS)
        .eq('owner_user_id', ownerUserId).eq('status', 'open').in('client_id', clientIds),
      'hypotheses',
    ),
    // Minimal columns: we only need the latest event stamp per client. Reduced
    // to a per-client max in memory; when fleets carry deep event logs this
    // becomes an aggregate RPC, but the shape here (one query) stays the same.
    rows(
      db.from('insight_events').select('client_id, created_at')
        .eq('owner_user_id', ownerUserId).in('client_id', clientIds),
      'insight_events',
    ),
    rows(
      db.from('client_insights').select('client_id, content, confidence, structured')
        .eq('owner_user_id', ownerUserId).eq('status', 'active').eq('kind', 'seasonality')
        .in('client_id', clientIds),
      'client_insights',
    ),
    rows(
      db.from('campaigns').select('client_id')
        .eq('owner_user_id', ownerUserId).in('client_id', clientIds)
        .in('status', ACTIVE_CAMPAIGN_STATUSES),
      'campaigns',
    ),
  ]);

  // ── Group in memory ──
  const openByClient     = new Map<string, OpenHypothesisProgress[]>();
  const lastEventBy      = new Map<string, number>();
  const calendarByClient = new Map<string, CalendarProximity[]>();
  const campaignCountBy  = new Map<string, number>();

  for (const u of hypothesisRows) {
    if (!isHypothesisRow(u)) {
      console.warn('[attention] skipping malformed hypotheses row');
      continue;
    }
    // Progress toward the floor: observed value when the caller injected one,
    // else UNKNOWN → 0 (test_refs tell us the test is live, but not how far).
    const observed = opts.observations?.[u.id];
    const sampleProgress =
      observed !== undefined && Number.isFinite(observed) ? Math.max(0, observed) : 0;
    const decisionWeight =
      Math.max(1, u.insight_ids.length) * DOMAIN_DECISION_MULTIPLIER[u.domain];

    const list = openByClient.get(u.client_id) ?? [];
    list.push({ hypothesis: u, sampleProgress, decisionWeight });
    openByClient.set(u.client_id, list);
  }

  for (const u of eventRows) {
    if (!isEventStamp(u)) {
      console.warn('[attention] skipping malformed insight_events row');
      continue;
    }
    const t = Date.parse(u.created_at);
    if (Number.isNaN(t)) continue;
    const prev = lastEventBy.get(u.client_id);
    if (prev === undefined || t > prev) lastEventBy.set(u.client_id, t);
  }

  for (const u of seasonalityRows) {
    if (!isSeasonalityAtom(u)) continue; // free-form jsonb — malformed atoms are expected; skip
    const proximity = parseSeasonalityAtom(u, now);
    if (proximity === null) continue;
    const list = calendarByClient.get(u.client_id) ?? [];
    list.push(proximity);
    calendarByClient.set(u.client_id, list);
  }

  for (const u of campaignRows) {
    if (!isClientIdRow(u)) {
      console.warn('[attention] skipping malformed campaigns row');
      continue;
    }
    campaignCountBy.set(u.client_id, (campaignCountBy.get(u.client_id) ?? 0) + 1);
  }

  // ── Assemble ──
  return clientIds.map((clientId): ClientAttentionState => {
    const lastEvent = lastEventBy.get(clientId);
    return {
      clientId,
      ownerUserId,
      // Reflex tier (C-05) is not built yet; the shape is ready and scoring is
      // live, so C-05 only has to fill this list.
      anomalyFlags:   [],
      openHypotheses: openByClient.get(clientId) ?? [],
      staleness: {
        daysSinceLastAtomEvent:
          lastEvent === undefined ? null : Math.max(0, (now.getTime() - lastEvent) / MS_PER_DAY),
        cadenceDays,
      },
      calendar: calendarByClient.get(clientId) ?? [],
      // TODO(C-06→meta-health wire-in): meta_connections is keyed to the LEGACY
      // meta_clients id space (019), not clients (026), and carries no token-
      // expiry column — so pipe health is NOT trivially readable per client
      // here. Until the id spaces are bridged, callers inject flags via
      // opts.errorFlags (lib/meta-health readiness reports produce them).
      errorStates:     opts.errorFlags?.[clientId] ?? [],
      activeCampaigns: campaignCountBy.get(clientId) ?? 0,
    };
  });
}

/**
 * Load the attention state for ONE client. Same query plan as the fleet
 * loader (batched over a single-element id list) so behavior never diverges.
 */
export async function loadClientState(
  db:          SupabaseClient | AttentionDb,
  clientId:    string,
  ownerUserId: string,
  opts:        LoadStateOpts = {},
): Promise<ClientAttentionState> {
  const seam = toAttentionDb(db);
  const states = await loadStatesForClients(seam, ownerUserId, [clientId], opts);
  // clientIds.map(...) above guarantees one state per requested id.
  return states[0];
}

/**
 * Load attention states for an owner's WHOLE fleet: one `clients` query for
 * the ids, then one query per ledger table across all clients (never per
 * client). Feed the result to rankClients for the tick ordering.
 */
export async function loadStatesForOwner(
  db:          SupabaseClient | AttentionDb,
  ownerUserId: string,
  opts:        LoadStateOpts = {},
): Promise<ClientAttentionState[]> {
  const seam = toAttentionDb(db);
  const clientRows = await rows(
    seam.from('clients').select('id').eq('owner_user_id', ownerUserId),
    'clients',
  );

  const clientIds: string[] = [];
  for (const u of clientRows) {
    if (isRecord(u) && typeof u.id === 'string') clientIds.push(u.id);
  }

  return loadStatesForClients(seam, ownerUserId, clientIds, opts);
}
