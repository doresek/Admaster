// lib/heartbeat/ticks/daily.ts
//
// The DAILY tick (VISION-DEEP §1.2): "cheap, mostly mechanical" — the
// watchdog. Deterministic by construction: no LLM, no Date.now — the anatomy
// is (1) shock annotation, (2) open-hypothesis review (kill rules + floor-met
// resolutions), (3) every action routed through the autonomy modes BEFORE any
// execution.
//
// MONEY DOCTRINE OF THE MVP DAILY TICK: no money moves here beyond PROTECTIVE
// pauses. spendContext is therefore zeros — the tick has moved nothing today
// or this month, and until the live money pipe exists there is no ledger to
// read real numbers from (see routeAndLog's parameter contract). Budget
// reallocation (§2.2's daily step) arrives with the metrics pipe.
//
// KNOWLEDGE vs MONEY ACTIONS: resolving a hypothesis moves ATOMS (beliefs),
// not shekels — verdicts flow through resolveAndLearn → the lifecycle engine,
// which is the C-01 discipline's own audited path (learning_signals +
// insight_events). Routing a resolution through the autonomy ladder would let
// an owner "reject" a measured outcome, which is exactly the self-deception
// the frozen-verdict ledger exists to prevent. So: pause_paid (money-adjacent,
// protective) routes through autonomy; resolve_hypothesis (knowledge) records
// route 'execute' directly.

import type { HeartbeatAction } from '@/lib/capability-contracts';
import { routeAndLog } from '@/lib/autonomy';
import {
  checkKillRules,
  floorMet,
  armFloorProgress,
  listHypotheses,
  resolveAndLearn,
  type ArmObservation,
  type HypothesisResolution,
  type HypothesisRow,
  type KillAction,
} from '@/lib/hypotheses';
import { NO_OBSERVATIONS, type TickContext, type TickDeps, type TickResult } from '../types';

/** No spend ledger yet → the daily tick has moved ₪0 today/this month. */
const ZERO_SPEND = { todaySpendIls: 0, monthSpendIls: 0 } as const;

/** Map a kill verdict to the resolution provenance C-01 records. */
function resolvedByFor(kill: KillAction): HypothesisResolution['resolved_by'] {
  if (kill.kind === 'force_resolve') return 'horizon_forced';
  return kill.rule === 'mercy' ? 'killed_mercy' : 'killed_catastrophic';
}

/**
 * Resolve one hypothesis through resolveAndLearn and narrate the outcome.
 * Returns the action to record (or null when the resolution was a no-op
 * replay — someone already resolved it, which is the idempotency contract
 * working, not an error).
 */
async function resolveAndRecord(
  ctx:        TickContext,
  deps:       TickDeps,
  hypothesis: HypothesisRow,
  obs:        ArmObservation[],
  now:        Date,
  notes:      string[],
  resolvedBy?: HypothesisResolution['resolved_by'],
): Promise<HeartbeatAction | null> {
  const result = await resolveAndLearn(deps.supabase, hypothesis, obs, { now, resolvedBy });
  if (!result.applied) {
    notes.push(`hypothesis ${hypothesis.id}: already resolved (${result.status}) — replay-safe no-op`);
    return null;
  }
  const applied = result.moves.filter((m) => m.outcome === 'applied' || m.outcome === 'atom_refuted').length;
  const failed  = result.moves.filter((m) => m.outcome !== 'applied' && m.outcome !== 'atom_refuted');
  notes.push(
    `hypothesis ${hypothesis.id} resolved '${result.status}' — ${applied}/${result.moves.length} atom moves applied` +
    (failed.length > 0 ? `; unapplied: ${failed.map((m) => `${m.insight_id}=${m.outcome}${m.note ? ` (${m.note})` : ''}`).join(', ')}` : ''),
  );
  return {
    kind:      'resolve_hypothesis',
    ref:       hypothesis.id,
    rationale: result.resolution?.verdict_reason ?? `resolved '${result.status}'`,
    // Knowledge action — executes without the autonomy ladder (see header).
    route:     'execute',
  };
}

/**
 * The §1.2 daily anatomy:
 *   1. SHOCK ANNOTATION — ctx.shock is the fleet-wide C-04 state for
 *      yesterday's cpm (computed once per fleet by the scheduler). On a
 *      shocked day the run is annotated "שוק, לא אתה" and step 2's KILL
 *      actions are SUPPRESSED: C-04 exists precisely so market-level events
 *      (chag, war news cycle, platform change) don't get read as campaign
 *      failure — market days don't kill campaigns, and atoms are protected
 *      from false weakening.
 *   2. OPEN-HYPOTHESIS REVIEW — per open hypothesis:
 *        • observations from the injectable provider; null (the MVP default)
 *          → "no metrics pipe — progress unknown", nothing moves.
 *        • checkKillRules with an EMPTY spendByArm (no spend ledger yet —
 *          the catastrophic rule, which needs spend, stays dormant until the
 *          money pipe lands; mercy and horizon work off observations alone).
 *          A kill → {kind:'pause_paid'} routed through autonomy FIRST:
 *          protective, so it executes at propose_approve+ and is proposed in
 *          draft_only. Only an 'execute' verdict resolves the hypothesis
 *          (killed_mercy/killed_catastrophic); a 'propose' leaves it open for
 *          the owner's tap.
 *        • horizon expiry → force-resolve (a time-based verdict, not a kill —
 *          it proceeds even on shocked days; the frozen prediction decides).
 *        • floor met → resolveAndLearn: the verdict moves atoms — THE LOOP
 *          CLOSING. On a shocked day the resolution still runs but the run
 *          carries the shock note so a reader can weigh it.
 */
export async function runDailyTick(ctx: TickContext, deps: TickDeps): Promise<TickResult> {
  const now = deps.now ?? new Date();
  const observations = deps.observations ?? NO_OBSERVATIONS;
  const notes: string[] = [...ctx.notes];
  const actions: HeartbeatAction[] = [];

  // 1) shock annotation
  const shocked = ctx.shock?.shocked === true;
  if (shocked) {
    notes.push(
      `שוק, לא אתה: fleet-wide cpm shock (${ctx.shock?.direction ?? '?'}, factor ${ctx.shock?.factor ?? '?'}` +
      `${ctx.shock?.note ? `, ${ctx.shock.note}` : ''}) — kill actions suppressed today (C-04)`,
    );
  }

  // 2) open-hypothesis review
  const open = await listHypotheses(deps.supabase, {
    clientId:    ctx.clientId,
    ownerUserId: ctx.ownerUserId,
    status:      'open',
  });
  if (open.length === 0) notes.push('no open hypotheses — nothing to review today');

  for (const h of open) {
    const obs = observations.forHypothesis(h.id);
    if (obs === null) {
      notes.push(`hypothesis ${h.id}: no metrics pipe — progress unknown`);
      continue;
    }

    // No spend ledger yet → catastrophic rule dormant (documented above).
    const kill = checkKillRules(h, obs, {}, now);

    if (kill && kill.kind === 'kill_arm') {
      if (shocked) {
        notes.push(
          `hypothesis ${h.id}: kill rule '${kill.rule}' fired for arm '${kill.arm}' but today is a market shock day — ` +
          `שוק, לא אתה: suppressed (market days don't kill campaigns; C-04 protects atoms from false weakening)`,
        );
        continue;
      }

      // 3) route FIRST, execute only on 'execute'.
      const routed = await routeAndLog(deps.supabase, {
        clientId:     ctx.clientId,
        ownerUserId:  ctx.ownerUserId,
        action: {
          kind:        'pause_paid',
          ref:         h.id,
          rationale:   kill.reason,
          grounded_in: h.insight_ids,
        },
        spendContext: ZERO_SPEND,
      });
      actions.push({ kind: 'pause_paid', ref: h.id, rationale: kill.reason, route: routed.route.route });
      notes.push(`hypothesis ${h.id}: pause_paid routed '${routed.route.route}' (${routed.route.reason})`);

      if (routed.route.route === 'execute') {
        const action = await resolveAndRecord(ctx, deps, h, obs, now, notes, resolvedByFor(kill));
        if (action) actions.push(action);
      }
      continue;
    }

    if (kill && kill.kind === 'force_resolve') {
      notes.push(`hypothesis ${h.id}: horizon reached (${kill.reason}) — forcing resolution`);
      const action = await resolveAndRecord(ctx, deps, h, obs, now, notes, 'horizon_forced');
      if (action) actions.push(action);
      continue;
    }

    if (floorMet(h.floor_spec, obs)) {
      const action = await resolveAndRecord(ctx, deps, h, obs, now, notes);
      if (action) actions.push(action);
      continue;
    }

    const minProgress = obs.length > 0
      ? Math.min(...obs.map((o) => armFloorProgress(h.floor_spec, o)))
      : 0;
    notes.push(`hypothesis ${h.id}: running, floor progress ${Math.round(minProgress * 100)}% — no verdict yet`);
  }

  return { actions, notes };
}
