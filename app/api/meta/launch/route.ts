import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';
import { loadMetaClientContext, loadApprovedAd } from '@/lib/meta-launch-data';
import {
  uploadAdImage, buildObjectStorySpec, launchFullCampaign,
  destinationLink, defaultCtaFor, destinationToObjective, checkAdScopes,
} from '@/lib/meta-ads';
import { toMetaTargetingSpec } from '@/lib/meta-targeting';
import type { Destination, TargetingSuggestion } from '@/types';

// Minimal idempotency cache (mirrors the images route) — prevents double-launch on double-click.
const idem = new Map<string, { body: unknown; status: number; expiresAt: number }>();
const IDEM_TTL = 60_000;
if (typeof setInterval !== 'undefined') {
  setInterval(() => { const now = Date.now(); for (const [k, v] of idem) if (v.expiresAt < now) idem.delete(k); }, 60_000).unref?.();
}

// POST /api/meta/launch — create campaign+adset+creative+ad (all PAUSED). Credit: campaign (15).
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = checkRateLimit(`meta-launch:${user.id}`, { max: 10, windowMs: 60_000 });
    if (!rl.ok) return NextResponse.json({ error: 'יותר מדי בקשות, נסה שוב בעוד מעט' }, { status: 429 });

    const idemKey = req.headers.get('Idempotency-Key');
    if (idemKey) {
      const hit = idem.get(`${user.id}:${idemKey}`);
      if (hit && hit.expiresAt > Date.now()) return NextResponse.json(hit.body, { status: hit.status });
    }

    const body = await req.json();
    const { clientId, approvalId, headline, primaryText, cta, budget, campaignName } = body;
    const destination = body.destination as Destination;
    const targeting = body.targeting as TargetingSuggestion;
    if (!clientId || !approvalId || !destination?.type || !targeting) {
      return NextResponse.json({ error: 'Missing clientId, approvalId, destination or targeting' }, { status: 400 });
    }

    const [ctx, ad] = await Promise.all([
      loadMetaClientContext(supabase, clientId, user.id),
      loadApprovedAd(supabase, approvalId, user.id),
    ]);
    if (!ad.imageUrl) return NextResponse.json({ error: 'למודעה המאושרת אין תמונה' }, { status: 400 });

    // Preflight token scopes BEFORE spending a credit.
    const scopes = await checkAdScopes(ctx.token);
    if (!scopes.ok) {
      return NextResponse.json(
        { error: `ל-token של הלקוח חסרות הרשאות: ${scopes.missing.join(', ')}. חבר מחדש את חשבון ה-Meta עם הרשאות מודעות.` },
        { status: 403 },
      );
    }

    const deduct = await deductCredits(supabase, user.id, 'campaign');
    if (!deduct.ok) return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });

    try {
      const { imageHash } = await uploadAdImage(ctx.token, ctx.adAccountId, ad.imageUrl);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://admaster-three.vercel.app';
      const link = destinationLink(destination, appUrl);
      const resolvedCta = cta || defaultCtaFor(destination.type);

      const spec = buildObjectStorySpec({
        pageId: ctx.pageId, headline: headline || ad.title || '', primaryText: primaryText || ad.text,
        destination, imageHash, link, cta: resolvedCta,
      });

      const dailyBudget = Number(budget) > 0 ? Math.round(Number(budget)) : targeting.dailyBudget;
      const metaTargeting = toMetaTargetingSpec(targeting);
      const objective = destinationToObjective(destination.type);

      const result = await launchFullCampaign(ctx.token, ctx.adAccountId, {
        pageId: ctx.pageId,
        campaignName: campaignName || ad.title || 'AdMaster Ad',
        destinationType: destination.type,
        dailyBudget,
        targeting: metaTargeting,
        objectStorySpec: spec,
      });

      // Persist + bump the client's campaign counter (best-effort).
      const { data: row } = await supabase.from('launched_ads').insert({
        user_id: user.id, client_id: clientId, approval_id: approvalId,
        ad_account_id: ctx.adAccountId,
        campaign_id: result.campaignId, adset_id: result.adSetId,
        creative_id: result.creativeId, ad_id: result.adId,
        destination, targeting: metaTargeting, budget: dailyBudget, objective,
        headline: headline || ad.title || '', primary_text: primaryText || ad.text,
        cta: resolvedCta, image_url: ad.imageUrl, status: 'PAUSED',
      }).select('id').maybeSingle();

      const acc = ctx.adAccountId.replace(/^act_/, '');
      const responseBody = {
        launchedAdId: row?.id ?? null,
        campaignId: result.campaignId,
        adId: result.adId,
        status: 'PAUSED' as const,
        adsManagerUrl: `https://business.facebook.com/adsmanager/manage/campaigns?act=${acc}&selected_campaign_ids=${result.campaignId}`,
        credits: deduct.credits,
      };
      if (idemKey) idem.set(`${user.id}:${idemKey}`, { body: responseBody, status: 200, expiresAt: Date.now() + IDEM_TTL });
      return NextResponse.json(responseBody);
    } catch (err: any) {
      await refundCredits(supabase, user.id, 'campaign', deduct.cost);
      return NextResponse.json({ error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
