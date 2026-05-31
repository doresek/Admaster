// app/api/autopilot/resume/route.ts
// Resume an autopilot run after the client approves. Picks up at 'targeting'.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getJourney } from '@/lib/journey';
import { runAutopilot } from '@/lib/autopilot/orchestrator';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { runId } = (await req.json().catch(() => ({}))) as { runId?: string };
  if (!runId) return NextResponse.json({ error: 'Missing runId' }, { status: 400 });

  const { data: run } = await supabase
    .from('autopilot_runs')
    .select('id, user_id, client_id, journey_id, status')
    .eq('id', runId)
    .maybeSingle();
  if (!run || run.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (run.status !== 'awaiting_approval') {
    return NextResponse.json({ error: `cannot_resume_from_${run.status}` }, { status: 409 });
  }

  // verify the linked approval is actually approved
  const journey = await getJourney(supabase, user.id, run.client_id ?? null);
  if (!journey) return NextResponse.json({ error: 'journey_not_found' }, { status: 404 });
  if (journey.approval_id) {
    const { data: appr } = await supabase
      .from('approvals')
      .select('status')
      .eq('id', journey.approval_id)
      .maybeSingle();
    if (appr?.status !== 'approved') {
      return NextResponse.json({ error: 'not_approved_yet', approvalStatus: appr?.status ?? null }, { status: 409 });
    }
  }

  await supabase.from('autopilot_runs').update({ status: 'running' }).eq('id', runId);

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const cookieHeader = req.headers.get('cookie') ?? '';

  const outcome = await runAutopilot(
    { supabase, userId: user.id, clientId: run.client_id ?? null, runId, baseUrl, cookieHeader, locale: 'he', journey },
    'targeting',
  );

  return NextResponse.json({ ok: outcome.status !== 'failed', runId, ...outcome });
}
