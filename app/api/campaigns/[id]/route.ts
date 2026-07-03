// app/api/campaigns/[id]/route.ts
//
//   GET /api/campaigns/:id   one campaign + its items + its grounded decision log
//                            (the WHY behind every choice). Authed + owner-scoped.

import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { supabaseCampaignStore } from '@/lib/campaigns/store';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const store = supabaseCampaignStore(createAdminClient());
    const campaign = await store.getCampaign(params.id, user.id);
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [items, decisions] = await Promise.all([
      store.listItems(campaign.id, user.id),
      store.listDecisions(campaign.id, user.id),
    ]);

    return NextResponse.json({ campaign, items, decisions });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
