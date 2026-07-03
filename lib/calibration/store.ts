// lib/calibration/store.ts
//
// Data layer for C-03 calibration — the ONLY file in lib/calibration that
// touches the database. C-03 owns no tables: it reads resolved hypotheses
// (C-01, migration 034) and stamps Brier scores back into their `resolution`
// jsonb (the `brier?` field HypothesisResolution reserves for exactly this).
//
// Conventions per lib/intelligence/insights.ts: the Supabase client is
// dependency-injected, every read/write is explicitly owner-scoped (correct
// under both the RLS user client and the service-role admin client), and
// every response's `error` is checked — no silent failures.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  HYPOTHESIS_COLUMNS,
  type HypothesisDomain,
  type HypothesisStatus,
} from '@/lib/capability-contracts';
import { toSample, type CalibrationHypothesis } from './core';
import type { CalibrationSample } from './types';

// ── The DB seam ───────────────────────────────────────────────────────────────
//
// The exact structural slice of SupabaseClient this module uses. A real
// SupabaseClient satisfies it at runtime; the toCalibrationDb bridge below
// narrows it via a runtime type-predicate (see its JSDoc for why structural
// ASSIGNMENT is impossible under Next's build type pass). Tests inject a
// plain stub that implements the slice directly — no casts on either side.
//
// Two deliberate typing choices, both forced by tsc's recursion limits when
// structurally comparing the real PostgrestFilterBuilder: `then` is declared
// inline (not via `extends PromiseLike<...>`) and `data` is `unknown` rather
// than row-typed — either of the stricter forms trips "type instantiation is
// excessively deep" (TS2589). `data: unknown` is also the honest type: jsonb
// coming back from the DB is runtime-untrusted, so this file narrows it with
// runtime guards instead of compile-time assertions.

interface DbError { message: string }

/** What awaiting a query resolves to. `data` is narrowed by runtime guards. */
export interface DbResponse { data: unknown; error: DbError | null }

/** The filter/thenable chain `from('hypotheses').select(...)` returns. */
export interface HypothesesFilter {
  eq(column: string, value: string): HypothesesFilter;
  in(column: string, values: readonly string[]): HypothesesFilter;
  gte(column: string, value: string): HypothesesFilter;
  single(): { then<X>(onfulfilled: (response: DbResponse) => X | PromiseLike<X>): PromiseLike<X> };
  then<X>(onfulfilled: (response: DbResponse) => X | PromiseLike<X>): PromiseLike<X>;
}

/** The structural slice of SupabaseClient that calibration needs. */
export interface CalibrationDb {
  from(table: 'hypotheses'): {
    select(columns: string): HypothesesFilter;
    update(values: Record<string, unknown>): HypothesesFilter;
  };
}

const isCalibrationDbLike = (u: unknown): u is CalibrationDb =>
  isRecord(u) && typeof u.from === 'function';

/**
 * Boundary bridge: treat a live SupabaseClient (or a test seam) as the
 * structural CalibrationDb slice. Direct structural ASSIGNMENT
 * (`const db: CalibrationDb = supabase`) passes bare `tsc --noEmit` but blows
 * the instantiation depth (TS2589) under Next's build type pass — tsc cannot
 * compare PostgrestFilterBuilder's self-referential generics against any
 * structural builder slice (supabase-js v2 type pathology; same finding as
 * lib/attention/load.ts). So the bridge is a RUNTIME-guarded type-predicate
 * narrowing through `unknown` (zero casts): it checks the one thing the seam
 * needs — a callable `from` — while the chain shapes are compatible by
 * construction and every row is narrowed by narrowRow below.
 */
const toCalibrationDb = (supabase: SupabaseClient | CalibrationDb): CalibrationDb => {
  const candidate: unknown = supabase;
  if (!isCalibrationDbLike(candidate)) {
    throw new Error('[calibration] supabase client does not expose from()');
  }
  return candidate;
};

// ── Runtime narrowing ─────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const HYPOTHESIS_STATUSES: readonly HypothesisStatus[] =
  ['open', 'supported', 'refuted', 'inconclusive', 'killed', 'superseded'];

const HYPOTHESIS_DOMAINS: readonly HypothesisDomain[] =
  ['angle', 'audience', 'offer', 'creative', 'funnel', 'timing', 'channel', 'other'];

/**
 * Narrow one raw row to the slice calibration reads. Rows that fail the
 * status/domain guards are effectively impossible (the DB CHECK constraints
 * enforce the same string unions the contracts declare) — returning null here
 * is a data-integrity backstop, not a code path. A non-numeric `confidence`
 * is carried as absent so toSample records the exclusion.
 */
const narrowRow = (row: unknown): CalibrationHypothesis | null => {
  if (!isRecord(row)) return null;
  const { status, domain, prediction } = row;

  // find() both proves membership and yields the union-typed value — no cast.
  const typedStatus = HYPOTHESIS_STATUSES.find((s) => s === status);
  const typedDomain = HYPOTHESIS_DOMAINS.find((d) => d === domain);
  if (typedStatus === undefined || typedDomain === undefined) return null;

  const confidence = isRecord(prediction) && typeof prediction.confidence === 'number'
    ? prediction.confidence
    : undefined;

  return confidence === undefined
    ? { status: typedStatus, domain: typedDomain, prediction: {} }
    : { status: typedStatus, domain: typedDomain, prediction: { confidence } };
};

// ── loadSamples ───────────────────────────────────────────────────────────────

export interface LoadSamplesScope {
  ownerUserId: string;
  /** Optional narrowing to one client; omitted = all the owner's clients. */
  clientId?:   string;
  /** Rolling window over resolved_at; default 90 days (spec §C-03). */
  windowDays?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Load the calibration samples for a scope: hypotheses resolved to
 * `supported` or `refuted` within the rolling window, mapped through
 * toSample. Rows toSample excludes (missing/invalid confidence — statuses are
 * already filtered by the query) simply contribute no sample; the exclusion
 * semantics live in core.toSample where they are unit-tested.
 */
export async function loadSamples(
  supabase: SupabaseClient | CalibrationDb,
  scope: LoadSamplesScope,
): Promise<CalibrationSample[]> {
  const windowDays = scope.windowDays ?? 90;
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new Error(`loadSamples: windowDays must be a finite number > 0, got ${windowDays}`);
  }
  const since = new Date(Date.now() - windowDays * DAY_MS).toISOString();

  const db = toCalibrationDb(supabase);
  let query = db
    .from('hypotheses')
    .select(HYPOTHESIS_COLUMNS)
    .eq('owner_user_id', scope.ownerUserId)
    .in('status', ['supported', 'refuted'])
    .gte('resolved_at', since);
  if (scope.clientId !== undefined) query = query.eq('client_id', scope.clientId);

  const { data, error } = await query;
  if (error) throw new Error(`loadSamples: ${error.message}`);

  const samples: CalibrationSample[] = [];
  for (const row of Array.isArray(data) ? data : []) {
    const hypothesis = narrowRow(row);
    if (hypothesis === null) continue;
    const result = toSample(hypothesis);
    if (result.sample !== null) samples.push(result.sample);
  }
  return samples;
}

// ── stampBrier ────────────────────────────────────────────────────────────────

/**
 * Stamp a Brier score into a hypothesis's `resolution` jsonb.
 *
 * Read-modify-write: the row's CURRENT resolution is fetched and `brier` is
 * merged into it, so the frozen resolution evidence (observed metrics,
 * verdict_reason, resolved_by) is never clobbered by the stamp. A hypothesis
 * with no resolution cannot be stamped — a Brier score only exists relative
 * to a verdict — so that is an error, not a silent create.
 */
export async function stampBrier(
  supabase: SupabaseClient | CalibrationDb,
  hypothesisId: string,
  brierScore: number,
): Promise<void> {
  if (!Number.isFinite(brierScore) || brierScore < 0 || brierScore > 1) {
    throw new Error(`stampBrier: brier must be a finite number in [0,1], got ${brierScore}`);
  }

  const db = toCalibrationDb(supabase);
  const { data, error } = await db
    .from('hypotheses')
    .select('id, resolution')
    .eq('id', hypothesisId)
    .single();
  if (error) throw new Error(`stampBrier: read failed: ${error.message}`);

  const resolution = isRecord(data) && isRecord(data.resolution) ? data.resolution : null;
  if (resolution === null) {
    throw new Error(`stampBrier: hypothesis ${hypothesisId} has no resolution to stamp`);
  }

  const { error: updateError } = await db
    .from('hypotheses')
    .update({
      resolution: { ...resolution, brier: brierScore },
      updated_at: new Date().toISOString(),
    })
    .eq('id', hypothesisId);
  if (updateError) throw new Error(`stampBrier: update failed: ${updateError.message}`);
}
