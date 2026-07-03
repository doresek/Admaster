// app/api/hypotheses/[id]/route.ts
//
//   GET /api/hypotheses/:id   one ledger entry — the frozen registration, its
//                             status and (when resolved) the resolution with
//                             the observed snapshot. Authed + owner-scoped.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { getHypothesis } from '@/lib/hypotheses/store';

export const runtime = 'nodejs';

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const hypothesis = await getHypothesis(createAdminClient(), params.id, user.id);
    if (!hypothesis) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ hypothesis });
  } catch (err: unknown) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
