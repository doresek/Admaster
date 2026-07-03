// lib/heartbeat/scheduler.ts
//
// The fan-out (VISION-DEEP §6.2): one runHeartbeat call per cron fire →
// per-client job rows claimed, run, and terminated in the heartbeat_runs
// ledger. Sequential, isolated, deterministic:
//
//   • FLEET WORK FIRST, ONCE: for daily ticks, computeDailyFactors runs for
//     yesterday BEFORE any client tick — the shock state every client's
//     verdict reads must exist before the first verdict is attempted, and it
//     is fleet-wide by definition (C-04's one sanctioned cross-tenant read),
//     so computing it per client would be both wrong and N× the cost.
//
//   • ATTENTION ORDER IS PROCESSING ORDER: clients are processed in
//     rankClients order per owner (C-06). This is where information-value
//     allocation becomes REAL — when a cron window is cut short (timeout,
//     deploy), the clients that lose their tick are exactly the ones where
//     attention buys the least. The score snapshot is stamped on the claimed
//     row's `attention` column so every run answers "why this client, now".
//
//   • PER-CLIENT ISOLATION: one client's failure marks ITS run failed and
//     the loop continues — a bad brief or a poisoned row must never stop the
//     fleet's heartbeat.
//
//   • JITTER (MVP): sequential processing IS the jitter — clients hit
//     external APIs one at a time, never as a thundering herd. Randomized
//     jitter + parallel workers arrive with Vercel Queues if volume ever
//     justifies them (§6.2: "a jobs table is boring and sufficient to ~1k
//     clients").

import type { SupabaseClient } from '@supabase/supabase-js';
import type { HeartbeatTick, ShockState } from '@/lib/capability-contracts';
import {
  loadStatesForOwner,
  rankClients,
  type AttentionScore,
  type ClientAttentionState,
} from '@/lib/attention';
import { computeDailyFactors, getShockState, isoDayBefore } from '@/lib/fleet';
import { claimTick, markFailed, markRunning, markSucceeded } from './ledger';
import { runDailyTick } from './ticks/daily';
import { runWeeklyTick } from './ticks/weekly';
import { runMonthlyTick } from './ticks/monthly';
import type { TickContext, TickDeps, TickResult } from './types';

// ── results ───────────────────────────────────────────────────────────────────

export interface HeartbeatClientOutcome {
  clientId:    string;
  ownerUserId: string;
  /** The heartbeat_runs row, when one was claimed. */
  runId:       string | null;
  status:      'succeeded' | 'failed' | 'claim_skipped';
  error?:      string;
  actionCount: number;
}

export interface HeartbeatSummary {
  tick:    HeartbeatTick;
  ranAt:   string;
  results: HeartbeatClientOutcome[];
  /** Fleet-level observations (factor computation, owner-load failures, …). */
  notes:   string[];
}

/** The injectable seams runHeartbeat forwards to every tick. */
export type SchedulerDeps = Pick<TickDeps, 'observations' | 'campaignRunner'>;

export interface RunHeartbeatOptions {
  tick: HeartbeatTick;
  /** Clock override — one `now` for the whole run (claims, periods, ticks). */
  now?:  Date;
  deps?: SchedulerDeps;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const TICK_FNS: Record<HeartbeatTick, (ctx: TickContext, deps: TickDeps) => Promise<TickResult>> = {
  daily:   runDailyTick,
  weekly:  runWeeklyTick,
  monthly: runMonthlyTick,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The C-06 snapshot persisted on the run row — score + per-component WHYs. */
function attentionSnapshot(score: AttentionScore | null): Record<string, unknown> {
  if (!score) return { note: 'attention unavailable — processed in client-id order' };
  return { score: score.score, components: score.components };
}

/** One clients query for the WHOLE fleet, grouped by owner (owners sorted for determinism). */
async function loadFleet(admin: SupabaseClient): Promise<Map<string, string[]>> {
  const { data, error } = await admin.from('clients').select('id, owner_user_id');
  if (error) throw new Error(`runHeartbeat: clients query failed: ${error.message}`);

  const byOwner = new Map<string, string[]>();
  for (const raw of data ?? []) {
    const row: unknown = raw;
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.owner_user_id !== 'string') continue;
    const list = byOwner.get(row.owner_user_id) ?? [];
    list.push(row.id);
    byOwner.set(row.owner_user_id, list);
  }
  return new Map([...byOwner.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Rank one owner's clients by attention. Failure degrades to client-id order
 * (with the failure noted) — a broken ranking query must not cost the owner
 * their whole fleet's tick, only the optimality of its order.
 */
async function rankedOrder(
  admin:       SupabaseClient,
  ownerUserId: string,
  clientIds:   string[],
  now:         Date,
  notes:       string[],
): Promise<Array<{ clientId: string; score: AttentionScore | null }>> {
  try {
    const states: ClientAttentionState[] = await loadStatesForOwner(admin, ownerUserId, { now });
    const ranked = rankClients(states, { topKDetail: 10 });
    const known = new Set(clientIds);
    const order: Array<{ clientId: string; score: AttentionScore | null }> = ranked
      .filter((s) => known.has(s.clientId))
      .map((s) => ({ clientId: s.clientId, score: s }));
    // Clients the ranking somehow missed still get their tick, at the tail.
    const seen = new Set(order.map((o) => o.clientId));
    for (const id of [...clientIds].sort()) {
      if (!seen.has(id)) order.push({ clientId: id, score: null });
    }
    return order;
  } catch (err: unknown) {
    notes.push(`attention ranking failed for owner ${ownerUserId}: ${errMessage(err)} — falling back to client-id order`);
    return [...clientIds].sort().map((clientId) => ({ clientId, score: null }));
  }
}

// ── the fan-out ───────────────────────────────────────────────────────────────

/**
 * Run one heartbeat tick across the whole fleet. See the header for the four
 * structural guarantees (fleet-first, attention order, isolation, sequential
 * jitter). Returns a summary the API route serves back to the cron caller —
 * the authoritative record stays in heartbeat_runs.
 */
export async function runHeartbeat(
  admin: SupabaseClient,
  opts:  RunHeartbeatOptions,
): Promise<HeartbeatSummary> {
  const { tick } = opts;
  const now = opts.now ?? new Date();
  const notes: string[] = [];
  const results: HeartbeatClientOutcome[] = [];

  // Fleet work first, once (daily only): yesterday's factors + shock state.
  let shock: ShockState | null = null;
  if (tick === 'daily') {
    try {
      const date = isoDayBefore(now.toISOString().slice(0, 10));
      const summary = await computeDailyFactors(admin, { date });
      notes.push(`fleet factors for ${date}: ${summary.note}`);
      shock = await getShockState(admin, date, 'cpm');
      if (shock.shocked) notes.push(`fleet cpm SHOCK on ${date} (${shock.direction ?? '?'}): kill actions will be suppressed`);
    } catch (err: unknown) {
      notes.push(`fleet factor computation failed: ${errMessage(err)} — proceeding without shock state (kills NOT suppressed)`);
      shock = null;
    }
  }

  const deps: TickDeps = {
    supabase:       admin,
    observations:   opts.deps?.observations,
    campaignRunner: opts.deps?.campaignRunner,
    now,
  };
  const tickFn = TICK_FNS[tick];

  const fleet = await loadFleet(admin);
  for (const [ownerUserId, clientIds] of fleet) {
    const order = await rankedOrder(admin, ownerUserId, clientIds, now, notes);

    for (const { clientId, score } of order) {
      // Per-client isolation: EVERYTHING for one client sits in one try/catch.
      let runId: string | null = null;
      try {
        const claimed = await claimTick(admin, clientId, ownerUserId, tick, {
          now,
          attention: attentionSnapshot(score),
        });
        if (!claimed) {
          results.push({ clientId, ownerUserId, runId: null, status: 'claim_skipped', actionCount: 0 });
          continue;
        }
        runId = claimed.id;

        await markRunning(admin, claimed.id, { now });
        const ctx: TickContext = { clientId, ownerUserId, tick, runId: claimed.id, shock, notes: [] };
        const result = await tickFn(ctx, deps);

        const finalNotes = result.skipped ? [...result.notes, `skipped: ${result.skipped}`] : result.notes;
        await markSucceeded(admin, claimed.id, result.actions, finalNotes, { now });
        results.push({ clientId, ownerUserId, runId, status: 'succeeded', actionCount: result.actions.length });
      } catch (err: unknown) {
        const message = errMessage(err);
        if (runId) {
          try {
            await markFailed(admin, runId, message, { now });
          } catch (markErr: unknown) {
            notes.push(`client ${clientId}: markFailed itself failed (${errMessage(markErr)}) — original error: ${message}`);
          }
        }
        results.push({ clientId, ownerUserId, runId, status: 'failed', error: message, actionCount: 0 });
      }
    }
  }

  return { tick, ranAt: now.toISOString(), results, notes };
}
