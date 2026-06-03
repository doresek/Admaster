import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';
import { getDecryptedMetaToken } from '@/lib/meta';
import { fetchInsights } from '@/lib/ad-insights';
import { analyzeAdPerformance } from '@/lib/ad-insights-ai';

// POST /api/meta/ad-insights — fetch a launched ad's live metrics + AI analysis.
// Body: { clientId, launchedAdId, analyze?: boolean }
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = checkRateLimit(`ad-insights:${user.id}`, { max: 20, windowMs: 60_000 });
    if (!rl.ok) return NextResponse.json({ error: 'יותר מדי בקשות, נסה שוב בעוד מעט' }, { status: 429 });

    const { clientId, launchedAdId, analyze = true } = await req.json();
    if (!clientId || !launchedAdId) return NextResponse.json({ error: 'Missing clientId or launchedAdId' }, { status: 400 });

    const { data: row } = await supabase
      .from('launched_ads')
      .select('ad_id, campaign_id, objective, headline, primary_text, budget, status')
      .eq('id', launchedAdId).eq('user_id', user.id).maybeSingle();
    if (!row?.ad_id && !row?.campaign_id) return NextResponse.json({ error: 'המודעה לא נמצאה' }, { status: 404 });

    const token = await getDecryptedMetaToken(supabase, clientId, user.id);
    if (!token) return NextResponse.json({ error: 'לא נמצא token תקין ללקוח' }, { status: 404 });

    const insights = await fetchInsights(token, (row.ad_id || row.campaign_id)!);

    if (!analyze) return NextResponse.json({ insights });

    // AI analysis is a paid step.
    const deduct = await deductCredits(supabase, user.id, 'ad_insights');
    if (!deduct.ok) return NextResponse.json({ insights, error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });

    try {
      const analysis = await analyzeAdPerformance(insights, {
        objective: row.objective, headline: row.headline, primaryText: row.primary_text,
        dailyBudget: row.budget, status: row.status,
      });
      return NextResponse.json({ insights, analysis, credits: deduct.credits });
    } catch (err: any) {
      await refundCredits(supabase, user.id, 'ad_insights', deduct.cost);
      return NextResponse.json({ insights, error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
