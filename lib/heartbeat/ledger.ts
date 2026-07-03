// lib/heartbeat/ledger.ts
//
// The claim-lease store over `heartbeat_runs` (migration 039; VISION-DEEP
// §6.2): per-client job rows, claimed with a lease, idempotent and
// crash-safe. The ledger is what makes ticks RESUMABLE: a crashed worker's
// claim expires and is reclaimable; a completed tick's 'succeeded' row blocks
// re-runs for the rest of its period — so the cron can fire twice (retry,
// redeploy, manual trigger) and each client still ticks at most once per
// period.
//
// PERIOD SEMANTICS (the idempotency window, anchored on created_at — the
// moment the tick ran):
//   daily   → the same UTC calendar day
//   weekly  → the same ISO week (Monday 00:00 UTC boundary)
//   monthly → the same calendar month (UTC)
// These are calendar windows, not rolling ones, on purpose: "the Monday
// morning plan" (§1.2) is a calendar ritual, and a Sunday-night retry must
// not eat Monday's tick.
//
// CONCURRENCY HONESTY: claim is check-then-insert, not a DB-atomic upsert —
// 039 carries no unique constraint over (client, tick, period). That is
// sufficient for the MVP's single Vercel-Cron invoker (one runHeartbeat at a
// time, sequential fan-out); if concurrent workers ever run, add a partial
// unique index and turn the insert into the arbiter (noted for the
// orchestrator).

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  HeartbeatAction,
  HeartbeatRunRow,
  HeartbeatTick,
} from '@/lib/capability-contracts';
import { HeartbeatLedgerError } from './types';

/** Columns of a heartbeat_runs read — mirrors migration 039 1:1. */
export const HEARTBEAT_RUN_COLUMNS =
  'id, client_id, owner_user_id, tick_type, status, attention, actions, notes, ' +
  'tokens_used, error, lease_until, started_at, finished_at, created_at';

/** Default claim lease — long enough for a slow tick, short enough to reclaim a crashed one within the same cron window. */
export const DEFAULT_LEASE_MINUTES = 10;

// ── period boundaries (pure, exported for tests) ──────────────────────────────

/** Start of `now`'s UTC calendar day. */
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Start of `now`'s ISO week: the most recent Monday, 00:00 UTC. getUTCDay()
 * is 0=Sunday..6=Saturday; (day+6)%7 is days-since-Monday.
 */
export function isoWeekStart(now: Date): Date {
  const day = utcDayStart(now);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * 86_400_000);
}

/** Start of `now`'s UTC calendar month. */
export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** The idempotency window's opening instant for a tick at `now`. */
export function periodStart(tick: HeartbeatTick, now: Date): Date {
  if (tick === 'daily') return utcDayStart(now);
  if (tick === 'weekly') return isoWeekStart(now);
  return utcMonthStart(now);
}

// ── claim ─────────────────────────────────────────────────────────────────────

export interface ClaimTickOptions {
  /** Lease length; a claim older than this is reclaimable (crashed worker). */
  leaseMinutes?: number;
  /** Clock override — every caller in the scheduler passes its single `now`. */
  now?: Date;
  /** The C-06 attention snapshot: WHY this client got attention this tick. */
  attention?: Record<string, unknown>;
}

/**
 * Claim the (client, tick) job for this period. Returns the freshly-claimed
 * 'claimed' row, or null when the tick is already handled — either a live
 * claim/run holds an unexpired lease, or a 'succeeded' row already exists
 * within the current period (the idempotency contract, §6.2: "each step
 * checks the ledger before acting").
 *
 * Stale-lease reclaim: a claimed/running row whose lease_until has passed
 * (or is null — a claim always sets one, so null means a malformed/manual
 * row) is marked 'failed' with note "lease expired" before the new claim is
 * inserted. The dead run's actions/notes stay on its own row — nothing is
 * overwritten, the ledger only ever gains rows and terminal states.
 */
export async function claimTick(
  admin:       SupabaseClient,
  clientId:    string,
  ownerUserId: string,
  tick:        HeartbeatTick,
  opts:        ClaimTickOptions = {},
): Promise<HeartbeatRunRow | null> {
  const now = opts.now ?? new Date();
  const leaseMinutes = opts.leaseMinutes ?? DEFAULT_LEASE_MINUTES;
  const nowIso = now.toISOString();

  // 1) Live or stale claims for this (client, tick).
  const { data: liveRows, error: liveErr } = await admin
    .from('heartbeat_runs')
    .select(HEARTBEAT_RUN_COLUMNS)
    .eq('client_id', clientId)
    .eq('tick_type', tick)
    .in('status', ['claimed', 'running'])
    .overrideTypes<HeartbeatRunRow[], { merge: false }>();
  if (liveErr) throw new HeartbeatLedgerError('claimTick.liveClaims', liveErr.message);

  for (const row of liveRows ?? []) {
    if (row.lease_until !== null && row.lease_until > nowIso) {
      // Someone (possibly a concurrent retry of ourselves) holds the job.
      return null;
    }
    // Expired (or malformed-null) lease → the worker died; fail its row and
    // reclaim. Transition is guarded on the row's current status so a racing
    // reclaim cannot double-fail it.
    const { error: staleErr } = await admin
      .from('heartbeat_runs')
      .update({
        status:      'failed',
        error:       'lease expired',
        notes:       [...row.notes, `lease expired at ${row.lease_until ?? '(null lease)'}; reclaimed at ${nowIso}`],
        finished_at: nowIso,
      })
      .eq('id', row.id)
      .eq('status', row.status);
    if (staleErr) throw new HeartbeatLedgerError('claimTick.reclaimStale', staleErr.message);
  }

  // 2) Already succeeded this period → done, do not double-tick.
  const { data: doneRows, error: doneErr } = await admin
    .from('heartbeat_runs')
    .select('id')
    .eq('client_id', clientId)
    .eq('tick_type', tick)
    .eq('status', 'succeeded')
    .gte('created_at', periodStart(tick, now).toISOString())
    .limit(1);
  if (doneErr) throw new HeartbeatLedgerError('claimTick.periodCheck', doneErr.message);
  if ((doneRows ?? []).length > 0) return null;

  // 3) Claim: insert the row with its lease. Every column is explicit so the
  //    returned row is a complete HeartbeatRunRow regardless of DB defaults.
  const { data: claimed, error: claimErr } = await admin
    .from('heartbeat_runs')
    .insert({
      client_id:     clientId,
      owner_user_id: ownerUserId,
      tick_type:     tick,
      status:        'claimed',
      attention:     opts.attention ?? {},
      actions:       [],
      notes:         [],
      tokens_used:   null,
      error:         null,
      lease_until:   new Date(now.getTime() + leaseMinutes * 60_000).toISOString(),
      started_at:    null,
      finished_at:   null,
      created_at:    nowIso,
    })
    .select(HEARTBEAT_RUN_COLUMNS)
    .single()
    .overrideTypes<HeartbeatRunRow, { merge: false }>();
  if (claimErr) throw new HeartbeatLedgerError('claimTick.insert', claimErr.message);
  return claimed;
}

// ── transitions (every one CAS-guarded on the legal source status) ────────────

/**
 * Run one guarded transition. The `.in('status', from)` filter makes it a
 * compare-and-set: a lost CAS (row not in a legal source state) throws — an
 * illegal transition in the run ledger is a bug or a race we must hear about,
 * never silently absorb (same doctrine as the campaign state machine).
 */
async function transition(
  admin:  SupabaseClient,
  runId:  string,
  from:   readonly string[],
  patch:  Record<string, unknown>,
  op:     string,
): Promise<HeartbeatRunRow> {
  const { data, error } = await admin
    .from('heartbeat_runs')
    .update(patch)
    .eq('id', runId)
    .in('status', [...from])
    .select(HEARTBEAT_RUN_COLUMNS)
    .maybeSingle()
    .overrideTypes<HeartbeatRunRow, { merge: false }>();
  if (error) throw new HeartbeatLedgerError(op, error.message);
  if (!data) {
    throw new HeartbeatLedgerError(
      op,
      `run ${runId} is not in a legal source state (${from.join('/')}) — transition refused`,
    );
  }
  return data;
}

/** claimed → running (stamps started_at). */
export async function markRunning(
  admin: SupabaseClient,
  runId: string,
  opts:  { now?: Date } = {},
): Promise<HeartbeatRunRow> {
  const nowIso = (opts.now ?? new Date()).toISOString();
  return transition(admin, runId, ['claimed'], { status: 'running', started_at: nowIso }, 'markRunning');
}

/** running → succeeded, recording the tick's actions + notes (the WHY-trail). */
export async function markSucceeded(
  admin:   SupabaseClient,
  runId:   string,
  actions: HeartbeatAction[],
  notes:   string[],
  opts:    { now?: Date } = {},
): Promise<HeartbeatRunRow> {
  const nowIso = (opts.now ?? new Date()).toISOString();
  return transition(
    admin, runId, ['running'],
    { status: 'succeeded', actions, notes, finished_at: nowIso },
    'markSucceeded',
  );
}

/** claimed|running → failed, with the error message (never swallowed). */
export async function markFailed(
  admin: SupabaseClient,
  runId: string,
  error: string,
  opts:  { now?: Date; notes?: string[] } = {},
): Promise<HeartbeatRunRow> {
  const nowIso = (opts.now ?? new Date()).toISOString();
  const patch: Record<string, unknown> = { status: 'failed', error, finished_at: nowIso };
  if (opts.notes) patch.notes = opts.notes;
  return transition(admin, runId, ['claimed', 'running'], patch, 'markFailed');
}

/** claimed → skipped, with the reason persisted (a skip is an explained decision, not silence). */
export async function markSkipped(
  admin:  SupabaseClient,
  runId:  string,
  reason: string,
  opts:   { now?: Date } = {},
): Promise<HeartbeatRunRow> {
  const nowIso = (opts.now ?? new Date()).toISOString();
  return transition(
    admin, runId, ['claimed', 'running'],
    { status: 'skipped', notes: [reason], finished_at: nowIso },
    'markSkipped',
  );
}
