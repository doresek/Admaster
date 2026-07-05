import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { FRAMEWORKS_BY_ID, type FrameworkId } from '@/lib/frameworks';
import { deductCredits, refundCredits, extractErrorMessage } from '@/lib/credits';
import { buildAiContext } from '@/lib/ai-context';
import { readActiveClientCookie } from '@/lib/active-client';
import { recordArtifactSafe, contextHash } from '@/lib/intelligence/artifacts';
import { supabaseCampaignStore } from '@/lib/campaigns/store';
import type { CampaignChannel, CampaignDecisionInsert } from '@/lib/campaigns/types';

// This route makes a ~40-60s Anthropic call (3 variants in one shot) and then
// records a campaign + items + decisions. The default Node function budget
// (10s/60s) is not enough — a request that runs long can be terminated and
// re-driven, which (now that we persist a campaigns row) duplicates the whole
// trace AND double-charges credits. Give it the full Fluid-Compute budget, the
// same as the master route.
export const runtime = 'nodejs';
export const maxDuration = 300;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const xt = (raw: string, t: string) => {
  const m = raw.match(new RegExp(`\\[${t}\\]([\\s\\S]*?)\\[\\/${t}\\]`));
  return m ? m[1].trim() : '';
};

// POST /api/quick-campaign
// body: { brief, platform, locale, framework?, generateImage? }
// returns: {
//   texts: [{ framework, post, hashtags, wa, image_prompt }],
//   image_urls: string[] (if generateImage and provider configured)
// }
//
// "Campaign" = 3 ad variants in 3 different frameworks + matching image prompts (and optionally generated images)
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    brief,
    platform = 'Facebook',
    locale = 'he',
    generateImage = false,
    client_id,
  } = await req.json() as {
    brief:    string;
    platform?: string;
    locale?:   'he' | 'en' | 'ar';
    generateImage?: boolean;
    client_id?: string | null;
  };

  if (!brief?.trim()) return NextResponse.json({ error: 'Missing brief' }, { status: 400 });

  const deduct = await deductCredits(supabase, user.id, 'campaign');
  if (!deduct.ok) return NextResponse.json({ error: deduct.error, credits: deduct.credits ?? 0 }, { status: deduct.status });

  // The active client comes from the app-wide context (explicit client_id) or the
  // cookie fallback — the same single source of truth as every other screen.
  const activeClientId = client_id ?? readActiveClientCookie(req.headers.get('cookie') ?? '');
  const ctx = await buildAiContext(supabase, { userId: user.id, clientId: activeClientId });
  const contextPrefix = ctx.combined ? `${ctx.combined}\n\n═══ TASK ═══\n` : '';

  try {

    const frameworks: FrameworkId[] = ['pas', 'aida', 'bab']; // 3 variants
    const lang = locale === 'en' ? 'in English' : locale === 'ar' ? 'بالعربية' : 'בעברית';

    // Build a single combined prompt to generate all 3 variants in one shot
    const sysParts = frameworks.map((f, i) => {
      const fw = FRAMEWORKS_BY_ID[f];
      return `[VARIANT ${i+1}: ${fw.name_en}]\n${fw.prompt}`;
    }).join('\n\n');

    const system = `${contextPrefix}אתה מומחה קופירייטינג ל-${platform}. צור 3 גרסאות מודעה ${lang}, כל גרסה לפי framework שונה.

${sysParts}

החזר בפורמט הזה בלבד:
[V1_POST]טקסט המודעה לגרסה 1 (PAS), עם אמוג'ים ו-CTA[/V1_POST]
[V1_HASHTAGS]8-12 hashtags[/V1_HASHTAGS]
[V1_WA]גרסה קצרה ל-WhatsApp[/V1_WA]
[V1_IMG]Detailed English prompt for Ideogram/Midjourney for variant 1[/V1_IMG]
[V2_POST]טקסט המודעה לגרסה 2 (AIDA)[/V2_POST]
[V2_HASHTAGS]8-12 hashtags[/V2_HASHTAGS]
[V2_WA]גרסה ל-WhatsApp[/V2_WA]
[V2_IMG]Detailed English image prompt for variant 2[/V2_IMG]
[V3_POST]טקסט המודעה לגרסה 3 (BAB)[/V3_POST]
[V3_HASHTAGS]8-12 hashtags[/V3_HASHTAGS]
[V3_WA]גרסה ל-WhatsApp[/V3_WA]
[V3_IMG]Detailed English image prompt for variant 3[/V3_IMG]`;

    const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    const msg = await anthropic.messages.create({
      model,
      max_tokens: 3500,
      system,
      messages: [{ role: 'user', content: `בריף: ${brief}` }],
    });

    const text = msg.content.find(b => b.type === 'text')?.text ?? '';

    const variants = [1, 2, 3].map(n => ({
      framework:     frameworks[n - 1],
      framework_name: FRAMEWORKS_BY_ID[frameworks[n - 1]].name_en,
      post:          xt(text, `V${n}_POST`),
      hashtags:      xt(text, `V${n}_HASHTAGS`).split(/\s+/).filter(h => h.startsWith('#')),
      wa:            xt(text, `V${n}_WA`),
      image_prompt:  xt(text, `V${n}_IMG`),
      image_url:     null as string | null,
    })).filter(v => v.post);

    // Save each variant to generated_content
    if (variants.length > 0) {
      await supabase.from('generated_content').insert(
        variants.map(v => ({
          user_id:   user.id,
          client_id: activeClientId ?? null,
          type:      'campaign',
          platform,
          input:    { brief: brief.substring(0, 500), framework: v.framework },
          output:   { post: v.post, hashtags: v.hashtags, wa: v.wa, image_prompt: v.image_prompt },
        }))
      );
    }

    // Tagged write-through to the artifact log + the grounded decision trace
    // (best-effort). This is the path owners actually use, so it must be auditable
    // like every other campaign path: we record one 'campaign' parent artifact and
    // each framework variant as an 'ad' child, AND a real campaigns row +
    // campaign_items (one per variant, linked to its artifact) + campaign_decisions
    // (channel · platform · framework) — every row grounded in the SAME insight
    // atoms buildAiContext used. It requires an active client (campaigns.client_id
    // is NOT NULL); with no client we still generate, we just can't attach a
    // client-scoped trace. Nothing here spends money or publishes: dry_run=true,
    // status 'assembled' (creative ready, nothing published), no Meta object.
    let campaignId: string | null = null;
    if (variants.length > 0 && activeClientId) {
      try {
        const admin = createAdminClient();
        const genModel = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
        const generatedFrom = { model: genModel, context_hash: contextHash(ctx.combined), platform };
        const parent = await recordArtifactSafe(admin, {
          clientId:    activeClientId,
          ownerUserId: user.id,
          type:        'campaign',
          content:     { brief: brief.substring(0, 500), variant_count: variants.length },
          insightIds:  ctx.insightIds,
          generatedFrom,
        });
        // Record each variant artifact, keeping its id to link a campaign_item.
        const variantArtifactIds: (string | null)[] = [];
        for (const v of variants) {
          const child = await recordArtifactSafe(admin, {
            clientId:    activeClientId,
            ownerUserId: user.id,
            type:        'ad',
            parentId:    parent?.id ?? null,
            content:     { post: v.post, hashtags: v.hashtags, wa: v.wa, image_prompt: v.image_prompt },
            framework:   v.framework,
            insightIds:  ctx.insightIds,
            generatedFrom,
          });
          variantArtifactIds.push(child?.id ?? null);
        }

        // The grounded campaign trace — dry-run, nothing published, no money moved.
        const store = supabaseCampaignStore(admin);
        // Constrained channel enum {meta_paid|meta_organic|whatsapp}: quick-campaign
        // is organic social content the owner publishes manually (never a paid buy
        // here) → meta_organic, or whatsapp when the platform IS WhatsApp.
        const channel: CampaignChannel = platform === 'WhatsApp' ? 'whatsapp' : 'meta_organic';
        const briefLabel = brief.replace(/\s+/g, ' ').trim().slice(0, 60);
        const frameworksUpper = variants.map(v => v.framework.toUpperCase());
        const campaign = await store.insertCampaign({
          client_id:        activeClientId,
          owner_user_id:    user.id,
          name:             `קמפיין מהיר · ${platform} · ${briefLabel}`,
          objective:        null,
          channel,
          status:           'assembled',
          daily_budget:     null,
          funnel_stage:     null,
          meta_campaign_id: null,
          dry_run:          true,
          grounded_in:      ctx.insightIds,
          rationale:        `קמפיין מהיר: ${variants.length} גרסאות (${frameworksUpper.join(' · ')}) ל-${platform}, מבוסס על ${ctx.insightIds.length} תובנות חיות של הלקוח.`,
        });
        campaignId = campaign?.id ?? null;

        if (campaign) {
          // One campaign_item per variant, linked to its artifact, so the Command
          // Center can render the creatives under the campaign.
          for (let i = 0; i < variants.length; i++) {
            const v = variants[i];
            await store.insertItem({
              campaign_id:    campaign.id,
              client_id:      activeClientId,
              owner_user_id:  user.id,
              artifact_id:    variantArtifactIds[i],
              item_type:      'post',
              status:         'assembled',
              meta_object_id: null,
              targeting_spec: {},
              grounded_in:    ctx.insightIds,
              rationale:      `גרסת ${v.framework.toUpperCase()} — ${FRAMEWORKS_BY_ID[v.framework as FrameworkId]?.name_en ?? v.framework}.`,
            });
          }
          // The grounded WHY-trail — auditable like every other campaign path.
          const g = ctx.insightIds;
          const base = { campaign_id: campaign.id, client_id: activeClientId, owner_user_id: user.id, grounded_in: g };
          const decisions: CampaignDecisionInsert[] = [
            {
              ...base,
              decision_type: 'channel',
              decision: { channel },
              rationale: `ערוץ = ${channel} (תוכן אורגני לפרסום ידני על ידי הבעלים; לא רכש ממומן).`,
            },
            {
              ...base,
              decision_type: 'platform',
              decision: { platform },
              rationale: `פלטפורמה = ${platform}.`,
            },
            {
              ...base,
              decision_type: 'framework',
              decision: { frameworks: variants.map(v => v.framework), variant_count: variants.length },
              rationale: `${variants.length} גרסאות ב-${variants.length} frameworks (${frameworksUpper.join(', ')}) — A/B טבעי מאותו בריף, מעוגן ב-${g.length} תובנות.`,
            },
          ];
          for (const di of decisions) await store.insertDecision(di);
        }
      } catch (e: any) {
        console.error('[quick-campaign] artifact/trace recording failed:', e?.message ?? e);
      }
    }

    // Optional: generate images for each variant (best effort; failures don't block the response)
    if (generateImage && process.env.IDEOGRAM_API_KEY) {
      await Promise.all(variants.map(async (v) => {
        if (!v.image_prompt) return;
        try {
          const res = await fetch('https://api.ideogram.ai/generate', {
            method: 'POST',
            headers: { 'Api-Key': process.env.IDEOGRAM_API_KEY!, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_request: {
                prompt: v.image_prompt,
                aspect_ratio: 'ASPECT_1_1',
                model: 'V_2',
                style_type: 'REALISTIC',
                magic_prompt_option: 'AUTO',
              },
            }),
          });
          const d = await res.json();
          v.image_url = d?.data?.[0]?.url ?? null;
          if (v.image_url) {
            await supabase.from('generated_images').insert({
              user_id: user.id, client_id: activeClientId ?? null, prompt: v.image_prompt, image_url: v.image_url,
              provider: 'ideogram', style: 'REALISTIC', aspect_ratio: 'ASPECT_1_1',
            });
          }
        } catch {} // tolerated
      }));
    }

    return NextResponse.json({ variants, credits: deduct.credits, campaign_id: campaignId });
  } catch (err: any) {
    await refundCredits(supabase, user.id, 'campaign', deduct.cost);
    console.error('[quick-campaign]', err);
    return NextResponse.json({ error: extractErrorMessage(err), refunded: deduct.cost }, { status: 502 });
  }
}
