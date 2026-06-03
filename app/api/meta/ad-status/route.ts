import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getDecryptedMetaToken } from '@/lib/meta';
import { setCampaignStatus } from '@/lib/meta-ads';

// POST /api/meta/ad-status — pause/activate a launched campaign. No credit.
// Body: { clientId, launchedAdId, status: 'ACTIVE' | 'PAUSED' }
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { clientId, launchedAdId, status } = await req.json();
    if (!clientId || !launchedAdId || (status !== 'ACTIVE' && status !== 'PAUSED')) {
      return NextResponse.json({ error: 'Missing clientId/launchedAdId or invalid status' }, { status: 400 });
    }

    const { data: row } = await supabase
      .from('launched_ads')
      .select('campaign_id')
      .eq('id', launchedAdId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!row?.campaign_id) return NextResponse.json({ error: 'המודעה לא נמצאה' }, { status: 404 });

    const token = await getDecryptedMetaToken(supabase, clientId, user.id);
    if (!token) return NextResponse.json({ error: 'לא נמצא token תקין ללקוח' }, { status: 404 });

    await setCampaignStatus(token, row.campaign_id, status);
    await supabase.from('launched_ads').update({ status }).eq('id', launchedAdId).eq('user_id', user.id);

    return NextResponse.json({ status });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
