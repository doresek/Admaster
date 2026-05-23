import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const GRAPH = 'https://graph.facebook.com/v19.0';

async function fetchInsights(adAccountId: string, token: string, datePreset: string) {
  const fields = 'impressions,clicks,spend,reach,frequency,ctr,cpc,cpm,actions,action_values,cost_per_action_type';
  const url = `${GRAPH}/${adAccountId}/insights?fields=${fields}&date_preset=${datePreset}&level=account&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.data?.[0] ?? null;
}

async function fetchCampaigns(adAccountId: string, token: string) {
  const fields = 'id,name,status,objective,daily_budget,lifetime_budget,insights{impressions,clicks,spend,ctr,cpc,actions}';
  const url = `${GRAPH}/${adAccountId}/campaigns?fields=${fields}&limit=20&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.data ?? [];
}

async function fetchTopAds(adAccountId: string, token: string) {
  const fields = 'id,name,status,creative{title,body,thumbnail_url},insights{impressions,clicks,spend,ctr,cpc,actions}';
  const url = `${GRAPH}/${adAccountId}/ads?fields=${fields}&limit=10&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.data ?? [];
}

// GET /api/analytics?clientId=xxx&datePreset=last_30d
export async function GET(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const clientId  = req.nextUrl.searchParams.get('clientId');
    const datePreset = req.nextUrl.searchParams.get('datePreset') || 'last_30d';

    if (!clientId) return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });

    const { data: client } = await supabase
      .from('meta_clients')
      .select('token, selected_ad_account_id, name')
      .eq('id', clientId).eq('user_id', user.id).single();

    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    if (!client.selected_ad_account_id) return NextResponse.json({ error: 'No ad account selected' }, { status: 400 });

    const [insights, campaigns, ads] = await Promise.allSettled([
      fetchInsights(client.selected_ad_account_id, client.token, datePreset),
      fetchCampaigns(client.selected_ad_account_id, client.token),
      fetchTopAds(client.selected_ad_account_id, client.token),
    ]);

    // Cache in DB
    const insightsData = insights.status === 'fulfilled' ? insights.value : null;
    if (insightsData) {
      const today = new Date().toISOString().split('T')[0];
      await supabase.from('ad_performance').upsert({
        user_id:          user.id,
        client_id:        clientId,
        ad_account_id:    client.selected_ad_account_id,
        date:             today,
        impressions:      parseInt(insightsData.impressions ?? '0'),
        clicks:           parseInt(insightsData.clicks ?? '0'),
        spend:            parseFloat(insightsData.spend ?? '0'),
        reach:            parseInt(insightsData.reach ?? '0'),
        frequency:        parseFloat(insightsData.frequency ?? '0'),
        ctr:              parseFloat(insightsData.ctr ?? '0'),
        cpc:              parseFloat(insightsData.cpc ?? '0'),
        cpm:              parseFloat(insightsData.cpm ?? '0'),
      }, { onConflict: 'client_id,ad_account_id,date' });
    }

    return NextResponse.json({
      insights: insightsData,
      campaigns: campaigns.status === 'fulfilled' ? campaigns.value : [],
      ads: ads.status === 'fulfilled' ? ads.value : [],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
