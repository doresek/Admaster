// app/api/intelligence/insights/route.ts
//
// READ endpoint for the Client Intelligence page. Returns the active living
// atoms (all layers) + the synthesized strategy snapshot for one client, scoped
// to the authenticated owner. Used by the build-in-progress poll and the
// post-signal refresh. Read-only — no mutations, no credits.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getClient, getClientStrategy } from '@/lib/clients';
import { listActiveInsights } from '@/lib/intelligence/insights';

export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });

  // Ownership gate — RLS already restricts, but verify explicitly so a foreign
  // id returns a clean 404 rather than an empty wall.
  const client = await getClient(supabase, clientId, user.id);
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const [insights, strategy] = await Promise.all([
    listActiveInsights(supabase, clientId),
    getClientStrategy(supabase, clientId).catch(() => null),
  ]);

  return NextResponse.json({
    insights,
    strategy,
    coreGeneratedAt: strategy?.core_generated_at ?? null,
  });
}
