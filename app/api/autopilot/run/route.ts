// app/api/autopilot/run/route.ts
// "Do it for me": runs the autopilot pipeline up to the human-approval gate.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { ensureJourney } from '@/lib/journey';
import { runAutopilot } from '@/lib/autopilot/orchestrator';
import { deductExplicit, refundExplicit } from '@/lib/autopilot/credits';

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

  // orchestration surcharge (per-step credits are charged by each sub-route)
  const deduct = await deductExplicit(supabase, user.id, 'autopilot_run');
  if (!deduct.ok) {
    return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });
  }

  let runId: string;
  try {
    const journey = await ensureJourney(supabase, user.id, clientId, 'brief_in');

    const { data: run, error: runErr } = await supabase
      .from('autopilot_runs')
      .insert({ user_id: user.id, client_id: clientId, journey_id: journey.id, status: 'running' })
      .select('id')
      .single();
    if (runErr) throw new Error(runErr.message);
    runId = run.id;

    await supabase.from('client_journeys').update({ current_run_id: runId, mode: 'autopilot' }).eq('id', journey.id);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const cookieHeader = req.headers.get('cookie') ?? '';

    const outcome = await runAutopilot(
      { supabase, userId: user.id, clientId, runId, baseUrl, cookieHeader, briefId: body.briefId ?? null, locale: 'he', journey },
    );

    // refund the orchestration surcharge if nothing useful happened
    if (outcome.status === 'failed' && outcome.stoppedAt === 'generate') {
      await refundExplicit(supabase, user.id, 'autopilot_run', deduct.cost);
    }

    return NextResponse.json({ ok: outcome.status !== 'failed', runId, ...outcome });
  } catch (e: any) {
    await refundExplicit(supabase, user.id, 'autopilot_run', deduct.cost);
    console.error('[autopilot/run] error:', e);
    return NextResponse.json({ error: e?.message ?? 'autopilot_failed', refunded: deduct.cost }, { status: 500 });
  }
}
