// app/api/campaigns/[id]/publish/route.ts
//
//   POST /api/campaigns/:id/publish   re-assemble / "publish" a campaign in
//                                     DRY-RUN (no spend, nothing unpaused).
//
// The LIVE publish path (creating real Meta objects, always PAUSED — never
// spend) is built (T9) but DISABLED by default. A { live: true } request is
// REFUSED with 403 unless LIVE_PUBLISH_ENABLED === 'true'; even then
// publishCampaign enforces a resolved token, the spend cap, and the PAUSED-only
// rule, and refuses (409) if any safety rule blocks it. The default dry-run
// "publish" simply confirms the assembled state and echoes the campaign — it
// makes ZERO live calls.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { supabaseCampaignStore } from '@/lib/campaigns/store';
import { canTransition, isLivePublishEnabled, publishCampaign, storedPlanResolver } from '@/lib/campaigns';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as { live?: boolean };

    // ── Money/H4 gate: the live path only runs behind an explicit flag. ──────────
    // With the flag OFF, refuse with 403 (unchanged behaviour). With it ON,
    // delegate to publishCampaign — which still enforces a resolved token, the
    // spend cap, and the PAUSED-only rule, and never spends. Paid objects are
    // ALWAYS created PAUSED; unpausing is a separate human action.
    if (body.live === true) {
      if (!isLivePublishEnabled()) {
        return NextResponse.json(
          {
            error: 'Live publish is gated (money + Meta H4 gates). Set LIVE_PUBLISH_ENABLED=true to enable.',
            gate: 'MONEY',
          },
          { status: 403 },
        );
      }

      const admin = createAdminClient();
      const result = await publishCampaign(
        { campaignId: (await params).id, ownerUserId: user.id, live: true },
        { resolvePlan: storedPlanResolver(admin) },
      );
      // A safety refusal (no token / over budget / not found) → 409; success → 200.
      return NextResponse.json(result, { status: result.refused ? 409 : 200 });
    }

    const store = supabaseCampaignStore(createAdminClient());
    const campaign = await store.getCampaign((await params).id, user.id);
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
