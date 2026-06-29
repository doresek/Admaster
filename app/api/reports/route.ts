import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';
import {
  aggregatePerformance,
  buildPeriodComparison,
  composeReportPrompt,
  cpaOf,
  priorPeriodRange,
} from '@/lib/report-metrics';

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
    .from('clients').select('name').eq('id', clientId).single();

  const { data: posts } = await supabase
    .from('scheduled_posts').select('*')
    .eq('client_id', clientId)
    .eq('status', 'published')
    .gte('scheduled_at', periodStart)
    .lte('scheduled_at', `${periodEnd}T23:59:59`);

  // Aggregate metrics (outcome-first; revenue/ROAS derived from per-row roas)
  const totals = aggregatePerformance(perf);

  const avgCtr = totals.clicks && totals.impressions ? ((totals.clicks / totals.impressions) * 100).toFixed(2) : '0';
  const avgCpc = totals.clicks ? (totals.spend / totals.clicks).toFixed(2) : '0';
  const cpaNum = cpaOf(totals);
  const cpa    = cpaNum === null ? 'N/A' : cpaNum.toFixed(2);

  // Period-over-period: fetch the immediately-preceding equal-length window.
  // Range is [periodStart - len, periodStart). Omit gracefully if empty.
  const prior = priorPeriodRange(periodStart, periodEnd);
  const { data: prevPerf } = await supabase
    .from('ad_performance')
    .select('*')
    .eq('client_id', clientId)
    .gte('date', prior.start)
    .lt('date', prior.endExclusive);

  const comparison = prevPerf && prevPerf.length > 0
    ? buildPeriodComparison(totals, aggregatePerformance(prevPerf))
    : null;

  // AI analysis — Hebrew prompt that LEADS with business outcomes (ROI),
  // then demotes activity metrics (impressions/reach/CTR/CPC) to context.
  const analysisMsg = await ai.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: composeReportPrompt({
        clientName: client?.name,
        periodStart,
        periodEnd,
        totals,
        avgCtr,
        avgCpc,
        postsPublished: posts?.length || 0,
        comparison,
      }),
    }],
  });

  const analysis = analysisMsg.content[0].type === 'text' ? analysisMsg.content[0].text : '';

  // Build report data
  const reportData = {
    client: client?.name,
    period: { start: periodStart, end: periodEnd },
    metrics: {
      impressions: totals.impressions,
      clicks:      totals.clicks,
      spend:       totals.spend,
      reach:       totals.reach,
      conversions: totals.conversions,
      avgCtr, avgCpc, cpa,
    },
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
