// app/api/strategy-objects/funnels/route.ts
//
//   GET /api/strategy-objects/funnels?clientId=[&status=][&id=]
//       list a client's funnels (newest first, optional status filter), or one
//       funnel's detail when `id` is given. READ-ONLY — funnel creation and
//       status transitions happen through the decision-engine / orchestrator
//       wire-ins, never over HTTP (same doctrine as app/api/hypotheses).
//
// Authed + owner-scoped per the app/api/campaigns pattern.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getClient } from '@/lib/clients';
import { getFunnel, listFunnels } from '@/lib/strategy-objects/store';
import type { FunnelRow } from '@/lib/capability-contracts';

export const runtime = 'nodejs';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const FUNNEL_STATUSES: readonly FunnelRow['status'][] = ['draft', 'active', 'archived'];

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = req.nextUrl.searchParams.get('clientId')?.trim();
    if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });

    const client = await getClient(supabase, clientId, user.id);
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

    const admin = createAdminClient();

    const id = req.nextUrl.searchParams.get('id')?.trim();
    if (id) {
      const funnel = await getFunnel(admin, id, user.id);
      // Detail must also belong to the asked-for client — a funnel id from
      // another of the owner's clients is a mismatch, not a hit.
      if (!funnel || funnel.client_id !== clientId) {
        return NextResponse.json({ error: 'Funnel not found' }, { status: 404 });
      }
      return NextResponse.json({ funnel });
    }

    const rawStatus = req.nextUrl.searchParams.get('status') ?? undefined;
    const status = FUNNEL_STATUSES.find((s) => s === rawStatus);
    if (rawStatus !== undefined && status === undefined) {
      return NextResponse.json({ error: `Invalid status '${rawStatus}'` }, { status: 400 });
    }

    const funnels = await listFunnels(admin, clientId, user.id, status);
    return NextResponse.json({ funnels });
  } catch (err: unknown) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
