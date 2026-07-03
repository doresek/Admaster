// lib/heartbeat/ticks/monthly.ts
//
// The MONTHLY tick — the strategy review (VISION-DEEP §1.2): re-synthesize
// the client's message architecture when the atoms drifted (synthesizeAndSave
// already skips on identical projections — no version churn), assess whether
// the client's track record justifies SUGGESTING the next autonomy mode (D1:
// suggestions ONLY — the owner always chooses; nothing here ever calls
// setMode), and compose the monthly digest.
//
// TODO (VISION-DEEP §2.7, J7): the advisory surface — when objection atoms
// recur across diagnoses and the failed link is repeatedly OFFER, the monthly
// tick should emit a business recommendation ("המלצה עסקית", clearly
// separated from marketing actions). Blocked on the diagnosis pipeline
// feeding failed-link rows; the digest already has room for it.

import type { HeartbeatAction } from '@/lib/capability-contracts';
import { assessModeSuggestion, getOrCreateAutonomy, recordModeSuggestion } from '@/lib/autonomy';
import { composeAndSave, type ApprovalRequest } from '@/lib/digest';
import { synthesizeAndSave } from '@/lib/strategy-objects';
import { utcMonthStart } from '../ledger';
import type { TickContext, TickDeps, TickResult } from '../types';

const fmtDay = (d: Date): string => d.toISOString().slice(0, 10);

/** Last day of `now`'s UTC month (day 0 of the next month). */
function utcMonthEnd(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
}

/**
 * The monthly anatomy:
 *   1. STRATEGY RE-SYNC — synthesizeAndSave projects the current atoms into a
 *      fresh message-architecture version; identical projection → skipped
 *      (the reason is noted, so "nothing drifted" is itself recorded).
 *   2. MODE SUGGESTION — assessModeSuggestion over the autonomy row; when the
 *      track record clears the bar (days in mode + decided approvals +
 *      approval rate), recordModeSuggestion logs that the owner SAW it, the
 *      run records a 'propose_only' action, and the digest carries it as an
 *      approval request. It does NOT go through routeAndLog: a mode
 *      suggestion is a proposal BY DEFINITION (routeAction maps propose_only
 *      → propose in every mode) and recordModeSuggestion already writes the
 *      dedicated audit event — routing it too would double-log the same ask.
 *   3. MONTHLY DIGEST — composeAndSave kind 'monthly' over the calendar
 *      month, approvalsNeeded = the suggestion + anything else this tick
 *      proposed.
 */
export async function runMonthlyTick(ctx: TickContext, deps: TickDeps): Promise<TickResult> {
  const now = deps.now ?? new Date();
  const notes: string[] = [...ctx.notes];
  const actions: HeartbeatAction[] = [];
  const approvalsNeeded: ApprovalRequest[] = [];

  // 1) strategy re-sync (skip-on-identical is the library's own discipline).
  const synth = await synthesizeAndSave(deps.supabase, ctx.clientId, ctx.ownerUserId, 'heartbeat_monthly');
  if (synth.skipped) {
    notes.push(`strategy re-sync skipped: ${synth.reason ?? 'identical projection'}`);
  } else {
    notes.push(
      `strategy re-synthesized: message architecture v${synth.architecture.version}` +
      (synth.diff && !synth.diff.identical ? ' (atoms drifted since the last version)' : ''),
    );
  }
  for (const w of synth.warnings) notes.push(`synthesis warning: ${w}`);

  // 2) mode suggestion (D1: suggest, never switch).
  const autonomy = await getOrCreateAutonomy(deps.supabase, ctx.clientId, ctx.ownerUserId);
  const assessment = assessModeSuggestion(autonomy, now);
  if (assessment.eligible && assessment.suggestion) {
    await recordModeSuggestion(deps.supabase, {
      clientId:    ctx.clientId,
      ownerUserId: ctx.ownerUserId,
      suggestion:  assessment.suggestion,
    });
    actions.push({
      kind:      'propose_only',
      rationale: assessment.suggestion.reason,
      route:     'propose',
    });
    approvalsNeeded.push({
      kind:      'mode_suggestion',
      rationale: assessment.suggestion.reason,
      ref:       assessment.suggestion.to_mode,
    });
    notes.push(`mode suggestion surfaced: ${assessment.suggestion.reason}`);
  } else {
    notes.push(`no mode suggestion (mode ${autonomy.mode}; the track record does not clear the bar or there is no next rung)`);
  }

  // 3) the monthly digest.
  const digest = await composeAndSave(deps.supabase, {
    clientId:    ctx.clientId,
    ownerUserId: ctx.ownerUserId,
    kind:        'monthly',
    periodStart: fmtDay(utcMonthStart(now)),
    periodEnd:   fmtDay(utcMonthEnd(now)),
    approvalsNeeded,
  });
  if (digest.ok) {
    notes.push(`monthly digest ${digest.digest.id} composed (${approvalsNeeded.length} approvals pending)`);
    for (const w of digest.warnings) notes.push(`digest warning: ${w}`);
  } else {
    notes.push(`monthly digest not recomposed: period digest already ${digest.status} (immutable)`);
  }

  return { actions, notes };
}
