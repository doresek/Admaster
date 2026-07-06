// app/api/organic/publish/route.ts
//
//   POST /api/organic/publish        run the organic publishing worker (P1-4)
//                                    in DRY-RUN — the Meta App-Review demo
//                                    flow (G0-4). This is what the review
//                                    screencast clicks.
//
// Request (authed):  { slot_id?: string }   — publish exactly this slot, OR
//                    { client_id?: string } — the client's due slots
//                    {}                     — all of the owner's due slots
//
// Response 200: PublishDueSlotsResult —
//   { live: false, dryRun: true, refused: false, message, results: [
//       { slotId, outcome: 'published'|'scheduled'|'proposed'|'blocked'|'skipped'|'failed',
//         metaPostId?, reason } ] }
//
// DRY-RUN ALWAYS from this route for now: `live` is HARDCODED false below.
// The G0-6 flip (after App-Review approval of pages_manage_posts) makes live
// possible by (a) accepting a gated `live` flag here — still behind
// LIVE_PUBLISH_ENABLED, mirroring app/api/campaigns/[id]/publish — and
// (b) wiring getDecryptedMetaToken into the worker's getToken dep. The worker
// itself needs zero structural change.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { routeAndLog } from '@/lib/autonomy';
import { supabaseCampaignStore } from '@/lib/campaigns/store';
import { publishDueSlots, supabaseSlotStore } from '@/lib/organic-publish';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as {
      slot_id?: string;
      client_id?: string;
    };
    if (body.slot_id !== undefined && typeof body.slot_id !== 'string') {
      return NextResponse.json({ error: 'slot_id must be a string' }, { status: 400 });
    }
    if (body.client_id !== undefined && typeof body.client_id !== 'string') {
      return NextResponse.json({ error: 'client_id must be a string' }, { status: 400 });
    }

    const admin = createAdminClient();
    const result = await publishDueSlots(
      {
        ownerUserId: user.id,
        slotId: body.slot_id,
        clientId: body.client_id,
        // DRY-RUN ALWAYS from this route for now (G0-6 flip: accept a gated
        // `live` flag here once pages_manage_posts is approved — see header).
        live: false,
      },
      {
        slotStore: supabaseSlotStore(admin),
        // Every publish routes + audits through the autonomy gate.
        route: (input) => routeAndLog(admin, input),
        campaignStore: supabaseCampaignStore(admin),
        // getToken: intentionally unwired — dry-run needs no credentials.
        // At the G0-6 flip: getToken: (cid, uid) => getDecryptedMetaToken(admin, cid, uid)
      },
    );

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
