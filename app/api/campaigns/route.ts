// app/api/campaigns/route.ts
//
//   GET  /api/campaigns[?clientId=]   list the owner's campaigns (newest first)
//   POST /api/campaigns               create + run a DRY-RUN campaign for
//                                     { clientId, channel } — turns the living
//                                     understanding into an assembled, recorded
//                                     campaign. NEVER spends (all objects PAUSED,
//                                     dry_run = true).
//
// Authed + owner-scoped. The runner uses the REAL decision engine; creative is
// generated via the master-studio-backed generator.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { runCampaign, type CampaignChannel } from '@/lib/campaigns';
import { supabaseCampaignStore } from '@/lib/campaigns/store';
import { masterStudioGenerator } from '@/lib/campaigns/generate';

// Best-of-N generation runs several sequential Anthropic calls.
export const runtime = 'nodejs';
export const maxDuration = 300;

const VALID_CHANNELS: CampaignChannel[] = ['meta_paid', 'meta_organic'];

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId = req.nextUrl.searchParams.get('clientId') ?? undefined;
    const store = supabaseCampaignStore(createAdminClient());
    const campaigns = await store.listCampaigns(user.id, clientId);
    return NextResponse.json({ campaigns });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await req.json()) as { clientId?: string; channel?: string; name?: string };
    const clientId = body.clientId?.trim();
    const channel = (body.channel?.trim() || 'meta_paid') as CampaignChannel;

    if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
    if (!VALID_CHANNELS.includes(channel)) {
      return NextResponse.json(
        { error: `channel must be one of ${VALID_CHANNELS.join(', ')}` },
        { status: 400 },
      );
    }

    const result = await runCampaign(
      { clientId, channel, ownerUserId: user.id, name: body.name },
      { generate: masterStudioGenerator({ userId: user.id, supabase }) },
    );

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
