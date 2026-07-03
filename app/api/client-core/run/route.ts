import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { orchestrateClientCore } from '@/lib/client-core/orchestrator';

// POST /api/client-core/run  { clientId, briefId, force? }
//
// Authenticated trigger + safety net for the durable client core. The brief
// submit endpoint fires the orchestrator fire-and-forget (non-blocking); on
// serverless that promise may be cut short. This route lets the dashboard run
// the orchestrator deterministically (and poll readiness via
// client_strategy.core_generated_at). The orchestrator is idempotent, so calling
// this after a successful fire-and-forget run is a safe no-op.
//
// This route AWAITS the orchestrator (it blocks the response), so no waitUntil is
// needed — but the chained 3-layer analysis can exceed the default function
// budget, so allow up to 300s.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { clientId, briefId, force } = (await req.json()) as {
    clientId?: string;
    briefId?:  string;
    force?:    boolean;
  };
  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
  }

  // Ownership (S1) — defense-in-depth. The RLS-scoped user client returns the client
  // row only if the caller owns it; refuse otherwise. The orchestrator re-verifies
  // ownership under the admin client, but we reject early here too.
  const { data: owned } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .maybeSingle();
  if (!owned) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Resolve the client's latest submitted brief when briefId is omitted, so the UI
  // can drive a deterministic build with only the clientId (the BuildingBrain retry
  // path). RLS scopes briefs to the caller; the orchestrator re-verifies ownership.
  let resolvedBriefId = briefId;
  if (!resolvedBriefId) {
    const { data: latest } = await supabase
      .from('briefs')
      .select('id')
      .eq('client_id', clientId)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    resolvedBriefId = latest?.id ?? undefined;
  }
  if (!resolvedBriefId) {
    return NextResponse.json({ error: 'No brief to build from' }, { status: 400 });
  }

  const result = await orchestrateClientCore(createAdminClient(), {
    userId: user.id,
    clientId,
    briefId: resolvedBriefId,
    force,
  });

  return NextResponse.json({ ok: true, ...result });
}
