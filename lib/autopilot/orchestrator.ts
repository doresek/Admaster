// lib/autopilot/orchestrator.ts
// Drives the autopilot pipeline: runs each step, threads accumulated data,
// records progress to autopilot_runs + journey_events, transitions the
// journey state, and STOPS at the human-approval gate. Resumable from any
// step (resume() picks up at 'targeting' after the client approves).

import type { SupabaseClient } from '@supabase/supabase-js';
import { getJourney, transition, type Journey, type JourneyState } from '@/lib/journey';
import { STEP_FNS } from './steps';
import { AUTOPILOT_CREDIT_COSTS, refundExplicit } from './credits';
import { PIPELINE, type StepCtx, type StepName, type RunStepRecord, type PipelineAcc } from './types';

// A run older than the function budget (maxDuration) whose status is still
// 'running' is provably dead: the invocation that created it cannot outlive
// maxDuration, so nothing is still driving it.
const STALE_RUN_MS = 5 * 60 * 1000;

/**
 * C2 self-heal: a hard serverless timeout kills the function before any
 * in-request cleanup can run, so we reconcile OPPORTUNISTICALLY on the next
 * invocation (called at the top of POST /api/autopilot/run). Sweep this user's
 * stale ('running' + older than the function budget) runs:
 *   - Prefer to RESUME the most-recent stale run for the SAME client from its
 *     `current_step` — its orchestration credit was already charged, so the
 *     caller reuses that run instead of paying + inserting a duplicate.
 *   - Fail + refund every other stale run so the lost credit is returned.
 * Best-effort: any failure here must never block starting the new run. The
 * status flip is done first with a `status='running'` guard and RETURNING, so
 * only the invocation that wins the flip issues the refund (no double-refund
 * under concurrent invocations).
 *
 * Note: resume is only offered for provably-dead (stale) runs, so there is no
 * risk of double-executing a live run. A non-stale 'running' run is left alone
 * (it may still be executing in a concurrent invocation).
 */
export async function reconcileStaleRuns(
  supabase: SupabaseClient,
  userId: string,
  clientId: string | null,
): Promise<{ id: string; fromStep: StepName } | null> {
  try {
    const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();
    const { data: stale } = await supabase
      .from('autopilot_runs')
      .select('id, client_id, current_step')
      .eq('user_id', userId)
      .eq('status', 'running')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: false });
    if (!stale?.length) return null;

    const resumable =
      stale.find((r) => (r.client_id ?? null) === (clientId ?? null) && r.current_step) ?? null;

    for (const r of stale) {
      if (resumable && r.id === resumable.id) continue;
      // Claim-then-refund: only the winner of the status flip refunds.
      const { data: claimed } = await supabase
        .from('autopilot_runs')
        .update({ status: 'failed', error: 'timed_out (reconciled on next run)', updated_at: new Date().toISOString() })
        .eq('id', r.id)
        .eq('status', 'running')
        .select('id');
      if (claimed?.length) {
        await refundExplicit(supabase, userId, 'autopilot_run', AUTOPILOT_CREDIT_COSTS.autopilot_run);
      }
    }

    return resumable ? { id: resumable.id, fromStep: resumable.current_step as StepName } : null;
  } catch (e) {
    console.error('[autopilot orchestrator] reconcileStaleRuns failed (non-blocking):', e);
    return null;
  }
}

// State the journey enters when a step *starts* / succeeds.
const STEP_STATE: Partial<Record<StepName, JourneyState>> = {
  generate: 'generating',
  score: 'scoring',
  approval: 'awaiting_approval',
  targeting: 'ready_to_launch',
  launch: 'live',
  insights: 'analyzing',
};

interface RunCtx extends Omit<StepCtx, 'journeyId'> {
  journey: Journey;
}

async function patchRun(
  supabase: SupabaseClient,
  runId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from('autopilot_runs')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', runId);
}

export interface RunOutcome {
  status: 'awaiting_approval' | 'done' | 'failed';
  stoppedAt: StepName | null;
  steps: RunStepRecord[];
  error?: string;
  acc: PipelineAcc;
}

export async function runAutopilot(rc: RunCtx, fromStep?: StepName): Promise<RunOutcome> {
  const { supabase, journey, runId } = rc;
  const startIdx = fromStep ? PIPELINE.indexOf(fromStep) : 0;
  const stepCtx: StepCtx = { ...rc, journeyId: journey.id };

  // load existing step records (so resume keeps prior history) + acc
  const { data: runRow } = await supabase
    .from('autopilot_runs')
    .select('steps, result')
    .eq('id', runId)
    .maybeSingle();
  const steps: RunStepRecord[] = Array.isArray(runRow?.steps) ? runRow!.steps : [];
  let acc: PipelineAcc = (runRow?.result as { acc?: PipelineAcc } | null)?.acc ?? {};

  let journeyRow = journey;

  const upsertStep = (name: StepName, patch: Partial<RunStepRecord>) => {
    const i = steps.findIndex((s) => s.name === name);
    if (i >= 0) steps[i] = { ...steps[i], ...patch };
    else steps.push({ name, status: 'pending', ...patch });
  };

  for (let i = startIdx; i < PIPELINE.length; i++) {
    const name = PIPELINE[i];
    upsertStep(name, { status: 'running', at: new Date().toISOString() });
    await patchRun(supabase, runId, { current_step: name, steps });

    let result;
    try {
      result = await STEP_FNS[name](stepCtx, acc);
    } catch (e: any) {
      result = { ok: false, error: e?.message ?? 'step_threw' };
    }

    if (result.data) acc = { ...acc, ...result.data };

    // reflect progress on the journey
    const toState = STEP_STATE[name];
    if (toState && journeyRow.state !== toState) {
      journeyRow = await transition(supabase, journeyRow, toState, {
        step: name,
        status: result.gate ? 'gate' : result.ok ? 'ok' : 'error',
        payload: result.data ?? {},
        patch: name === 'approval' && acc.approvalId ? { approval_id: acc.approvalId, current_run_id: runId } : undefined,
      });
    } else {
      // still log the event even without a state change (e.g. judge)
      const { logEvent } = await import('@/lib/journey');
      await logEvent(supabase, {
        journeyId: journeyRow.id,
        userId: rc.userId,
        step: name,
        status: result.ok ? 'ok' : 'error',
        payload: result.data ?? {},
      });
    }

    if (!result.ok) {
      upsertStep(name, { status: 'error', error: result.error, data: result.data });
      await patchRun(supabase, runId, { status: 'failed', error: result.error, steps, result: { acc } });
      if (journeyRow.state !== 'needs_attention') {
        journeyRow = await transition(supabase, journeyRow, 'needs_attention', { step: name, status: 'error', payload: { error: result.error } });
      }
      return { status: 'failed', stoppedAt: name, steps, error: result.error, acc };
    }

    upsertStep(name, { status: result.gate ? 'gate' : 'ok', data: result.data });
    await patchRun(supabase, runId, { steps, result: { acc } });

    if (result.gate) {
      await patchRun(supabase, runId, { status: 'awaiting_approval' });
      return { status: 'awaiting_approval', stoppedAt: name, steps, acc };
    }
  }

  await patchRun(supabase, runId, { status: 'done' });
  return { status: 'done', stoppedAt: null, steps, acc };
}

// Convenience: load the journey then run.
export async function startRun(rc: Omit<RunCtx, 'journey'>, opts: { fromStep?: StepName } = {}): Promise<RunOutcome> {
  const journey = await getJourney(rc.supabase, rc.userId, rc.clientId);
  if (!journey) throw new Error('journey_not_found');
  return runAutopilot({ ...rc, journey }, opts.fromStep);
}
