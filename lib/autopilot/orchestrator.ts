// lib/autopilot/orchestrator.ts
// Drives the autopilot pipeline: runs each step, threads accumulated data,
// records progress to autopilot_runs + journey_events, transitions the
// journey state, and STOPS at the human-approval gate. Resumable from any
// step (resume() picks up at 'targeting' after the client approves).

import type { SupabaseClient } from '@supabase/supabase-js';
import { getJourney, transition, type Journey, type JourneyState } from '@/lib/journey';
import { STEP_FNS } from './steps';
import { PIPELINE, type StepCtx, type StepName, type RunStepRecord } from './types';

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
  acc: Record<string, any>;
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
  let acc: Record<string, any> = (runRow?.result as any)?.acc ?? {};

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
