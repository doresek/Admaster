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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { clientId, briefId, force } = (await req.json()) as {
    clientId?: string;
    briefId?:  string;
    force?:    boolean;
  };
  if (!clientId || !briefId) {
    return NextResponse.json({ error: 'Missing clientId or briefId' }, { status: 400 });
  }

  const result = await orchestrateClientCore(createAdminClient(), {
    userId: user.id,
    clientId,
    briefId,
    force,
  });

  return NextResponse.json({ ok: true, ...result });
}
