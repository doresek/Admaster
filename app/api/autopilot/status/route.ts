// app/api/autopilot/status/route.ts
// Polled by the cockpit: returns the live run + journey + recent events.
// Also auto-resumes once the linked approval is approved (so the cockpit
// doesn't need a separate trigger).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getJourney } from '@/lib/journey';

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const runId = url.searchParams.get('runId');
  const clientId = url.searchParams.get('clientId');

  let run: any = null;
  if (runId) {
    const { data } = await supabase.from('autopilot_runs').select('*').eq('id', runId).eq('user_id', user.id).maybeSingle();
    run = data;
  } else if (clientId !== null) {
    const { data } = await supabase
      .from('autopilot_runs')
      .select('*')
      .eq('user_id', user.id)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    run = data;
  }

  const journey = await getJourney(supabase, user.id, clientId);

  let events: any[] = [];
  if (journey) {
    const { data } = await supabase
      .from('journey_events')
      .select('step, from_state, to_state, status, payload, created_at')
      .eq('journey_id', journey.id)
      .order('created_at', { ascending: false })
      .limit(20);
    events = data ?? [];
  }

  // is the approval gate cleared?
  let canResume = false;
  if (run?.status === 'awaiting_approval' && journey?.approval_id) {
    const { data: appr } = await supabase.from('approvals').select('status').eq('id', journey.approval_id).maybeSingle();
    canResume = appr?.status === 'approved';
  }

  return NextResponse.json({ run, journey, events, canResume });
}
