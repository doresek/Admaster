// app/api/autopilot/run/route.ts
// "Do it for me": runs the autopilot pipeline up to the human-approval gate.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { ensureJourney } from '@/lib/journey';
import { runAutopilot, reconcileStaleRuns } from '@/lib/autopilot/orchestrator';
import { AUTOPILOT_CREDIT_COSTS, deductExplicit, refundExplicit } from '@/lib/autopilot/credits';

// C2 (HIGH): this route drives a multi-step LLM pipeline that self-fetches the
// app's own routes, so it can run for minutes. Without an extended budget the
// serverless function is killed at the default (~10-15s) mid-pipeline — BEFORE
// the catch/refund runs — silently losing the orchestration credit and leaving
// the row stuck in 'running'. Mirror the other long routes (client-core/run,
// ai/master, briefs/submit, campaigns). The self-heal for runs that DID die
// this way lives in reconcileStaleRuns() (called at the top of POST).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = checkRateLimit(`autopilot:${user.id}`, { max: 10, windowMs: 60_000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'יותר מדי ריצות — נסה שוב בעוד רגע', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { clientId?: string | null; briefId?: string | null };
  const clientId = body.clientId ?? null;

  // C2 self-heal: sweep this user's timed-out runs first. If one is resumable
  // for this client we adopt it (its credit was already paid) instead of
  // charging + inserting a fresh run.
  const resume = await reconcileStaleRuns(supabase, user.id, clientId);

  // orchestration surcharge (per-step credits are charged by each sub-route).
  // Skipped when resuming — the adopted run already paid it.
  let deductCost: number = AUTOPILOT_CREDIT_COSTS.autopilot_run;
  if (!resume) {
    const deduct = await deductExplicit(supabase, user.id, 'autopilot_run');
    if (!deduct.ok) {
      return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });
    }
    deductCost = deduct.cost;
  }

  let runId: string;
  try {
    const journey = await ensureJourney(supabase, user.id, clientId, 'brief_in');

    if (resume) {
      runId = resume.id;
      // Re-arm the adopted run and clear the timed-out marker.
      await supabase
        .from('autopilot_runs')
        .update({ status: 'running', error: null, updated_at: new Date().toISOString() })
        .eq('id', runId);
    } else {
      const { data: run, error: runErr } = await supabase
        .from('autopilot_runs')
        .insert({ user_id: user.id, client_id: clientId, journey_id: journey.id, status: 'running' })
        .select('id')
        .single();
      if (runErr) throw new Error(runErr.message);
      runId = run.id;
    }

    await supabase.from('client_journeys').update({ current_run_id: runId, mode: 'autopilot' }).eq('id', journey.id);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const cookieHeader = req.headers.get('cookie') ?? '';

    const outcome = await runAutopilot(
      { supabase, userId: user.id, clientId, runId, baseUrl, cookieHeader, briefId: body.briefId ?? null, locale: 'he', journey },
      resume?.fromStep,
    );

    // refund the orchestration surcharge if nothing useful happened
    if (outcome.status === 'failed' && outcome.stoppedAt === 'generate') {
      await refundExplicit(supabase, user.id, 'autopilot_run', deductCost);
    }

    return NextResponse.json({ ok: outcome.status !== 'failed', runId, resumed: !!resume, ...outcome });
  } catch (e: any) {
    await refundExplicit(supabase, user.id, 'autopilot_run', deductCost);
    console.error('[autopilot/run] error:', e);
    return NextResponse.json({ error: e?.message ?? 'autopilot_failed', refunded: deductCost }, { status: 500 });
  }
}
