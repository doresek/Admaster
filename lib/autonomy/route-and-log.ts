// lib/autonomy/route-and-log.ts
//
// Composition: load the client's autonomy state, route one action through the
// pure policy, and write the audit event — the single call sites like the
// heartbeat make for EVERYTHING they want to do.
//
// HARD INVARIANT — no un-audited execution, EVER: an 'execute' verdict is only
// returned to the caller after its 'action_auto_executed' event has landed.
// If the audit write fails, the verdict is DOWNGRADED to 'propose' (reason:
// audit unavailable) — a log outage must degrade the system to asking, never
// let it act invisibly. Propose/block verdicts are returned as-is on log
// failure (they carry no execution risk; losing their event loses telemetry,
// not safety) with the failure logged loudly.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AutonomyAction, AutonomyMode, AutonomyRoute } from '@/lib/capability-contracts';
import type { RouteContext } from './types';
import { routeAction } from './policy';
import { countTodayActions, getOrCreateAutonomy, logRouteEvent } from './store';

export interface RouteAndLogInput {
  clientId:    string;
  ownerUserId: string;
  action:      AutonomyAction;
  /**
   * ILS the system already moved today / this calendar month. Supplied by the
   * CALLER: until the live money pipe exists there is no spend ledger this
   * module could read, and the heartbeat — which executes the actions — is
   * the one party that knows what it has already moved this tick/period.
   * When the money pipe lands, this becomes a read here and the parameter
   * goes away.
   */
  spendContext: { todaySpendIls: number; monthSpendIls: number };
}

export interface RouteAndLogResult {
  route: AutonomyRoute;
  mode:  AutonomyMode;
}

/**
 * Route one action through the mode policy AND audit it. Sequence:
 *   1. getOrCreateAutonomy — first touch creates the row in 'propose_approve'
 *      (the default mode, D1).
 *   2. countTodayActions — the rate-limit input (auto-executions since midnight).
 *      A count failure THROWS: we never route without the runaway counter
 *      (routing blind is exactly what the rate limit exists to prevent), and
 *      an unrouted action executes nothing — throwing is the safe direction.
 *   3. routeAction — the pure policy verdict.
 *   4. logRouteEvent — the audit; on failure, the fail-safe downgrade above.
 */
export async function routeAndLog(
  supabase: SupabaseClient,
  input:    RouteAndLogInput,
): Promise<RouteAndLogResult> {
  const row = await getOrCreateAutonomy(supabase, input.clientId, input.ownerUserId);
  const todayActionCount = await countTodayActions(supabase, input.clientId, input.ownerUserId);

  const ctx: RouteContext = {
    mode:             row.mode,
    caps:             row.caps,
    todayActionCount,
    todaySpendIls:    input.spendContext.todaySpendIls,
    monthSpendIls:    input.spendContext.monthSpendIls,
  };
  const route = routeAction(input.action, ctx);

  try {
    await logRouteEvent(supabase, {
      clientId:    input.clientId,
      ownerUserId: input.ownerUserId,
      action:      input.action,
      route,
    });
    return { route, mode: row.mode };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[routeAndLog] audit write failed:', message);

    // Propose/block: no execution risk un-audited — return the verdict, keep
    // the failure loud above.
    if (route.route !== 'execute') return { route, mode: row.mode };

    // THE FAIL-SAFE: execute without audit is forbidden — downgrade to propose.
    const downgraded: AutonomyRoute = {
      route:  'propose',
      reason: `audit unavailable — execution downgraded to proposal (${message}); original verdict: ${route.reason}`,
    };
    try {
      // Best effort: the audit store just failed, but a transient error may
      // have cleared; the downgraded verdict deserves its own event if possible.
      await logRouteEvent(supabase, {
        clientId:    input.clientId,
        ownerUserId: input.ownerUserId,
        action:      input.action,
        route:       downgraded,
      });
    } catch (retryErr: unknown) {
      const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
      console.error('[routeAndLog] downgraded-proposal audit also failed:', retryMessage);
    }
    return { route: downgraded, mode: row.mode };
  }
}
