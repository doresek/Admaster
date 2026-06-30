// app/api/campaigns/[id]/publish/route.ts
//
//   POST /api/campaigns/:id/publish   re-assemble / "publish" a campaign in
//                                     DRY-RUN (no spend, nothing unpaused).
//
// The LIVE publish path (creating real Meta objects / unpausing paid spend) is a
// gated Wave-2 step (T9 — money + H4 gates). Until that lands, a request with
// { live: true } is REFUSED with 403. The default dry-run "publish" simply
// confirms the assembled state and echoes the campaign — it makes ZERO live calls.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { supabaseCampaignStore } from '@/lib/campaigns/store';
import { canTransition } from '@/lib/campaigns';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { live?: boolean };

    // ── Money/H4 gate: the live path is intentionally not enabled here. ──────────
    // TODO(T9): implement live publish (create real Meta objects, create PAUSED,
    // require an explicit money-gate confirmation before unpausing paid spend).
    if (body.live === true) {
      return NextResponse.json(
        {
          error: 'Live publish is gated (money + Meta H4 gates). Not enabled in T2.',
          gate: 'MONEY',
        },
        { status: 403 },
      );
    }

    const store = supabaseCampaignStore(createAdminClient());
    const campaign = await store.getCampaign(params.id, user.id);
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Dry-run "publish" is a no-op confirmation: it never leaves dry-run and never
    // calls Meta. Surface whether a (gated) scheduling transition would be legal.
    return NextResponse.json({
      campaign,
      dryRun: true,
      published: false,
      message: 'Dry-run publish confirmed — no live Meta calls, nothing unpaused.',
      canSchedule: canTransition(campaign.status, 'scheduled'),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
