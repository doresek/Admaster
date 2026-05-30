import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';
import { loadMetaClientContext, loadApprovedAd } from '@/lib/meta-launch-data';
import { suggestTargeting } from '@/lib/meta-targeting';

// POST /api/meta/targeting — AI-suggested targeting + budget for a launch.
// Body: { clientId, approvalId }
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = checkRateLimit(`meta-targeting:${user.id}`, { max: 20, windowMs: 60_000 });
    if (!rl.ok) return NextResponse.json({ error: 'יותר מדי בקשות, נסה שוב בעוד מעט' }, { status: 429 });

    const { clientId, approvalId } = await req.json();
    if (!clientId || !approvalId) return NextResponse.json({ error: 'Missing clientId or approvalId' }, { status: 400 });

    const [ctx, ad] = await Promise.all([
      loadMetaClientContext(supabase, clientId, user.id),
      loadApprovedAd(supabase, approvalId, user.id),
    ]);

    const deduct = await deductCredits(supabase, user.id, 'ai_targeting');
    if (!deduct.ok) return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });

    try {
      const suggestion = await suggestTargeting(supabase, {
        userId: user.id, clientId, approvedAdText: ad.text,
        token: ctx.token, adAccountId: ctx.adAccountId,
      });
      return NextResponse.json({ suggestion, credits: deduct.credits });
    } catch (err: any) {
      await refundCredits(supabase, user.id, 'ai_targeting', deduct.cost);
      return NextResponse.json({ error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
