// app/api/hypotheses/route.ts
//
//   GET /api/hypotheses?clientId=[&status=][&domain=]
//        list a client's hypothesis-ledger entries (newest registration first)
//        for the command center. READ-ONLY — registration/resolution happen
//        through the decision-engine / runner wire-ins, never over HTTP.
//
// Authed + owner-scoped (same pattern as app/api/campaigns).

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { listHypotheses } from '@/lib/hypotheses/store';
import { isHypothesisDomain, isHypothesisStatus } from '@/lib/hypotheses/types';

export const runtime = 'nodejs';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = req.nextUrl.searchParams.get('clientId')?.trim();
    if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });

    const rawStatus = req.nextUrl.searchParams.get('status') ?? undefined;
    if (rawStatus !== undefined && !isHypothesisStatus(rawStatus)) {
      return NextResponse.json({ error: `Invalid status '${rawStatus}'` }, { status: 400 });
    }
    const rawDomain = req.nextUrl.searchParams.get('domain') ?? undefined;
    if (rawDomain !== undefined && !isHypothesisDomain(rawDomain)) {
      return NextResponse.json({ error: `Invalid domain '${rawDomain}'` }, { status: 400 });
    }

    const hypotheses = await listHypotheses(createAdminClient(), {
      clientId,
      ownerUserId: user.id,
      status: rawStatus,
      domain: rawDomain,
    });
    return NextResponse.json({ hypotheses });
  } catch (err: unknown) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
