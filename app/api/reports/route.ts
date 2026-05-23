import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// POST /api/reports — generate report
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { clientId, periodStart, periodEnd, sendTo } = await req.json();

  // Fetch performance data
  const { data: perf } = await supabase
    .from('ad_performance')
    .select('*')
    .eq('client_id', clientId)
    .gte('date', periodStart)
    .lte('date', periodEnd);

  const { data: client } = await supabase
    .from('meta_clients').select('name, industry').eq('id', clientId).single();

  const { data: posts } = await supabase
    .from('scheduled_posts').select('*')
    .eq('client_id', clientId)
    .eq('status', 'published')
    .gte('scheduled_at', periodStart)
    .lte('scheduled_at', `${periodEnd}T23:59:59`);

  // Aggregate metrics
  const totals = (perf ?? []).reduce((acc, row) => ({
    impressions: acc.impressions + row.impressions,
    clicks:      acc.clicks + row.clicks,
    spend:       acc.spend + parseFloat(row.spend),
    reach:       acc.reach + row.reach,
    conversions: acc.conversions + row.conversions,
  }), { impressions: 0, clicks: 0, spend: 0, reach: 0, conversions: 0 });

  const avgCtr = totals.clicks && totals.impressions ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : '0';
  const avgCpc = totals.clicks ? (totals.spend / totals.clicks).toFixed(2) : '0';
  const cpa    = totals.conversions ? (totals.spend / totals.conversions).toFixed(2) : 'N/A';

  // AI analysis
  const analysisMsg = await ai.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: `כתוב דוח שיווקי מקצועי בעברית עבור לקוח ${client?.name}.
תקופה: ${periodStart} עד ${periodEnd}
נתונים:
- חשיפות: ${totals.impressions.toLocaleString()}
- קליקים: ${totals.clicks.toLocaleString()}
- הוצאה: ₪${totals.spend.toFixed(2)}
- CTR: ${avgCtr}%
- CPC: ₪${avgCpc}
- פוסטים שפורסמו: ${posts?.length || 0}

כלול: סיכום ביצועים, הישגים עיקריים, מה שיפרנו, המלצות לתקופה הבאה.
טון מקצועי ונעים.`,
    }],
  });

  const analysis = analysisMsg.content[0].type === 'text' ? analysisMsg.content[0].text : '';

  // Build report data
  const reportData = {
    client: client?.name,
    period: { start: periodStart, end: periodEnd },
    metrics: { ...totals, avgCtr, avgCpc, cpa },
    postsPublished: posts?.length || 0,
    analysis,
  };

  // Save report
  const { data: report } = await supabase.from('reports').insert({
    user_id: user.id, client_id: clientId,
    title: `דוח ביצועים — ${client?.name} — ${periodStart}`,
    period_start: periodStart, period_end: periodEnd,
    data: reportData, sent_to: sendTo,
    sent_at: sendTo ? new Date().toISOString() : null,
  }).select().single();

  return NextResponse.json({ report, data: reportData });
}

// GET /api/reports?clientId=xxx
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  const query = supabase.from('reports').select('*').eq('user_id', user.id);
  if (clientId) query.eq('client_id', clientId);

  const { data } = await query.order('created_at', { ascending: false }).limit(20);
  return NextResponse.json(data ?? []);
}
