import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordArtifactWith } from '@/lib/intelligence/artifacts';
import { CREDIT_COSTS } from '@/types';
import { checkRateLimit } from '@/lib/rate-limit';
import { callVertexImageGen, GEMINI_ASPECT } from '@/lib/vertex-ai';
import { uploadToStorage } from '@/lib/image-storage';
import { runImagePipeline } from '@/lib/image-pipeline';
import { readActiveClientCookie } from '@/lib/active-client';

// "Nano Banana" — Google's image-gen Gemini models. Pro is the newer, higher-quality one.
// Available models (early 2026): gemini-2.5-flash-image, gemini-3-pro-image-preview, gemini-3.1-flash-image-preview
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';

// Idempotency cache: stores response by `${userId}:${key}` for 60s.
// Prevents double-charging when the client retries or double-clicks.
const idempotencyCache = new Map<string, { body: unknown; status: number; expiresAt: number }>();
const IDEMPOTENCY_TTL_MS = 60_000;

function getIdempotent(userId: string, key: string) {
  const k = `${userId}:${key}`;
  const hit = idempotencyCache.get(k);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) { idempotencyCache.delete(k); return null; }
  return hit;
}

function setIdempotent(userId: string, key: string, body: unknown, status: number) {
  idempotencyCache.set(`${userId}:${key}`, { body, status, expiresAt: Date.now() + IDEMPOTENCY_TTL_MS });
}

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of idempotencyCache) if (v.expiresAt < now) idempotencyCache.delete(k);
  }, 60_000).unref?.();
}

// Build a compact visual-direction prefix from a client-core avatar (Avatar v2).
// Pulls recommended_creative_angles + key visual cues; returns '' when absent so
// callers can no-op. Caps the angle list to keep the prompt budget in check.
function buildAvatarImageGrounding(avatar: any): string {
  if (!avatar || typeof avatar !== 'object') return '';
  const angles = Array.isArray(avatar.recommended_creative_angles)
    ? avatar.recommended_creative_angles.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 5)
    : [];
  const parts: string[] = [];
  if (angles.length) parts.push(`Creative angles: ${angles.join('; ')}`);
  if (typeof avatar.recommended_angle === 'string' && avatar.recommended_angle.trim()) {
    parts.push(`Primary angle: ${avatar.recommended_angle.trim()}`);
  }
  if (typeof avatar.occupation === 'string' && avatar.occupation.trim()) {
    parts.push(`Target audience: ${avatar.occupation.trim()}`);
  }
  if (!parts.length) return '';
  return `Visual direction for this client's audience — ${parts.join('. ')}.`;
}

async function generateGemini(
  supabase: SupabaseClient,
  userId: string,
  prompt: string,
  aspectRatio: string,
  sourceImageUrl?: string,
): Promise<string> {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error('לא מוגדר GOOGLE_SERVICE_ACCOUNT_JSON — צור Service Account ב-Google Cloud Console');
  }

  let sourceImage: { base64: string; mimeType: string } | undefined;
  if (sourceImageUrl) {
    const imgRes = await fetch(sourceImageUrl);
    if (!imgRes.ok) throw new Error('Could not fetch source image for Gemini edit');
    const buf = Buffer.from(await imgRes.arrayBuffer());
    sourceImage = {
      mimeType: imgRes.headers.get('content-type') || 'image/png',
      base64: buf.toString('base64'),
    };
  }

  const { base64, mimeType } = await callVertexImageGen({
    prompt,
    aspectRatio: GEMINI_ASPECT[aspectRatio] || '1:1',
    sourceImage,
    model: GEMINI_MODEL,
  });

  return uploadToStorage(supabase, userId, base64, mimeType);
}

async function generateIdeogram(prompt: string, aspectRatio: string, style: string) {
  const res = await fetch('https://api.ideogram.ai/generate', {
    method: 'POST',
    headers: {
      'Api-Key': process.env.IDEOGRAM_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      image_request: {
        prompt,
        aspect_ratio: aspectRatio,
        model: 'V_2',
        style_type: style,
        magic_prompt_option: 'AUTO',
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Ideogram error');
  return data.data?.[0]?.url;
}

async function remixIdeogram(imageUrl: string, prompt: string, aspectRatio: string, style: string) {
  // Fetch the source image as a file
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error('Could not fetch source image for remix');
  const arrayBuf = await imgRes.arrayBuffer();
  const blob = new Blob([arrayBuf], { type: imgRes.headers.get('content-type') || 'image/jpeg' });

  const form = new FormData();
  form.append('image_file', blob, 'source.jpg');
  form.append('image_request', JSON.stringify({
    prompt,
    aspect_ratio: aspectRatio,
    model:        'V_2',
    style_type:   style,
    image_weight: 60,
    magic_prompt_option: 'AUTO',
  }));

  const res = await fetch('https://api.ideogram.ai/remix', {
    method: 'POST',
    headers: { 'Api-Key': process.env.IDEOGRAM_API_KEY! },
    body:    form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Ideogram remix error');
  return data.data?.[0]?.url;
}

async function generateDallE(prompt: string, size: string) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3', prompt, n: 1, size, quality: 'hd',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'DALL-E error');
  return data.data?.[0]?.url;
}

// POST /api/images
// modes:
//   default (no mode)  — generate from prompt
//   mode='edit'        — refine an existing image: requires parentImageUrl + editPrompt
//   mode='adapt'       — adapt existing image to a different aspect ratio
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Rate limit: 10 image requests per minute per user.
    const rl = checkRateLimit(`images:${user.id}`, { max: 10, windowMs: 60_000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'יותר מדי בקשות, נסה שוב בעוד מעט', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      );
    }

    // Idempotency: same key within 60s returns the cached response.
    const idemKey = req.headers.get('Idempotency-Key');
    if (idemKey) {
      const cached = getIdempotent(user.id, idemKey);
      if (cached) return NextResponse.json(cached.body, { status: cached.status });
    }

    const body = await req.json();
    // Default to gemini if a key is configured (better Hebrew/text understanding); else ideogram.
    const defaultProvider = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'gemini' : 'ideogram';
    const { mode, prompt, aspectRatio = 'ASPECT_1_1', style = 'REALISTIC', provider = defaultProvider,
            parentImageId, parentImageUrl, editPrompt } = body;

    // Link every generated image to a client: explicit body client_id wins,
    // else the active-client cookie, else null. Mirrors the posts/landing writers.
    const activeClientId = body.client_id ?? readActiveClientCookie(req.headers.get('cookie') ?? '');

    const isEdit  = mode === 'edit';
    const isAdapt = mode === 'adapt';
    const action  = isAdapt ? 'img_adapt' : isEdit ? 'img_edit' : 'post';
    const cost    = CREDIT_COSTS[action];

    // ── Smart pipeline (best-of-N + LLM judge) — fresh generation only, never edit/adapt ──
    const smartEnabled = process.env.IMAGE_PIPELINE_SMART !== '0'
      && !!process.env.ANTHROPIC_API_KEY && !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const adCopy: string | undefined = body.adCopy;
    const useSmart = !mode && (body.smart ?? smartEnabled) && Boolean(adCopy?.trim() || prompt?.trim());

    if (useSmart) {
      const source = adCopy?.trim()
        ? { kind: 'adCopy' as const, text: adCopy.trim() }
        : { kind: 'prompt' as const, text: String(prompt).trim() };
      if (source.text.length > 2000) {
        return NextResponse.json({ error: 'Prompt ארוך מדי (מקסימום 2000 תווים)' }, { status: 400 });
      }

      const smartCost = CREDIT_COSTS['img_smart'];
      const { data: deduct } = await supabase.rpc('deduct_credits', {
        p_user_id: user.id, p_action: 'img_smart', p_cost: smartCost,
      });
      if (!deduct?.success) return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });

      try {
        const result = await runImagePipeline({
          supabase, userId: user.id, source,
          aspectRatio, style, clientId: activeClientId, briefId: body.brief_id ?? null,
        });

        const losers = result.candidates
          .filter(c => c.index !== result.winner.index)
          .map(c => {
            const s = result.judge.scores.find(sc => sc.index === c.index);
            return { url: c.url, concept: c.concept, total: s?.total ?? null };
          });

        const { error: insertErr } = await supabase.from('generated_images').insert({
          user_id:         user.id,
          client_id:       activeClientId ?? null,
          prompt:          result.winner.prompt,
          image_url:       result.winner.url,
          provider:        'gemini',
          style,
          aspect_ratio:    aspectRatio,
          candidate_urls:  losers,
          judge_rationale: result.judge.rationale,
          is_smart:        true,
        });
        if (insertErr) console.error('[images] smart DB insert failed:', insertErr);

        // Tagged write-through: record the winning creative as an artifact (best-effort).
        if (activeClientId) {
          await recordArtifactWith(createAdminClient, {
            clientId:    activeClientId,
            ownerUserId: user.id,
            type:        'creative_image',
            content:     { url: result.winner.url, prompt: result.winner.prompt, concept: result.winner.concept },
            funnelStage: null,
            generatedFrom: { model: GEMINI_MODEL, provider: 'gemini', smart: true },
          });
        }

        const responseBody = {
          url:        result.winner.url,
          candidates: [result.winner.url, ...losers.map(l => l.url)],
          rationale:  result.judge.rationale,
          smart:      true,
          partial:    result.partial,
          credits:    deduct.credits,
          ...(insertErr ? { warning: 'התמונה נוצרה אך לא נשמרה בהיסטוריה' } : {}),
        };
        if (idemKey) setIdempotent(user.id, idemKey, responseBody, 200);
        return NextResponse.json(responseBody);
      } catch (err: any) {
        await supabase.rpc('refund_credits', { p_user_id: user.id, p_action: 'img_smart', p_cost: smartCost });
        console.error('[images] smart pipeline failed:', err);
        return NextResponse.json({ error: err.message, refunded: smartCost }, { status: 502 });
      }
    }

    const finalPrompt = isAdapt
      ? `Re-render this exact scene in a new aspect ratio (${aspectRatio}). Preserve subject, colors, and composition.`
      : isEdit ? editPrompt : prompt;
    if (!finalPrompt) return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    if (finalPrompt.length > 2000) return NextResponse.json({ error: 'Prompt ארוך מדי (מקסימום 2000 תווים)' }, { status: 400 });
    if ((isEdit || isAdapt) && !parentImageUrl) return NextResponse.json({ error: 'Missing parentImageUrl' }, { status: 400 });

    // ── Simple-mode avatar grounding (W2.4b) ──────────────────────────
    // For plain prompt→image (not edit/adapt, not smart) ground the generation
    // in the active client's stored avatar: prepend its recommended creative
    // angles + key visual cues. No-op when there's no active client or no avatar.
    // (Smart mode already routes through buildAiContext, so it is untouched.)
    let genPrompt = finalPrompt;
    if (!isEdit && !isAdapt && activeClientId) {
      // The v2 avatar lives on client_strategy.avatar (one row per client),
      // keyed by the active v2 clients.id — NOT the legacy meta_clients.avatar
      // column, which does not exist on prod (that read failed silently, so
      // avatar image-grounding was dead). Mirrors lib/ai-context.ts.
      const { data: stratRow, error: stratErr } = await supabase
        .from('client_strategy')
        .select('avatar')
        .eq('client_id', activeClientId)
        .eq('owner_user_id', user.id)
        .maybeSingle();
      if (stratErr) console.error('[images] avatar-grounding read failed:', stratErr);
      const grounding = buildAvatarImageGrounding(stratRow?.avatar);
      if (grounding) genPrompt = `${grounding}\n\n${finalPrompt}`;
    }

    // Deduct credits
    const { data: deductResult } = await supabase.rpc('deduct_credits', {
      p_user_id: user.id, p_action: action, p_cost: cost,
    });
    if (!deductResult?.success) {
      return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
    }

    const dalleSize: Record<string, string> = {
      'ASPECT_1_1':  '1024x1024',
      'ASPECT_16_9': '1792x1024',
      'ASPECT_9_16': '1024x1792',
    };

    let imageUrl: string;

    // Try chosen provider; if Gemini fails with quota/billing, auto-fallback to Ideogram.
    const tryGenerate = async (p: string): Promise<{ url: string; fellBackTo?: string }> => {
      if (isEdit || isAdapt) {
        if (p === 'gemini' && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
          return { url: await generateGemini(supabase, user.id, finalPrompt, aspectRatio, parentImageUrl) };
        }
        if (p === 'ideogram' && process.env.IDEOGRAM_API_KEY) {
          return { url: await remixIdeogram(parentImageUrl, finalPrompt, aspectRatio, style) };
        }
        if (process.env.OPENAI_API_KEY) {
          const guided = `Based on this scene: a refined version with the following changes: ${finalPrompt}. Keep the original composition.`;
          return { url: await generateDallE(guided, dalleSize[aspectRatio] || '1024x1024') };
        }
        throw new Error('לא מוגדר API key לעריכת תמונות — הוסף GOOGLE_SERVICE_ACCOUNT_JSON, IDEOGRAM_API_KEY או OPENAI_API_KEY');
      }
      if (p === 'gemini' && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        return { url: await generateGemini(supabase, user.id, genPrompt, aspectRatio) };
      }
      if (p === 'ideogram' && process.env.IDEOGRAM_API_KEY) {
        return { url: await generateIdeogram(genPrompt, aspectRatio, style) };
      }
      if (process.env.OPENAI_API_KEY) {
        return { url: await generateDallE(genPrompt, dalleSize[aspectRatio] || '1024x1024') };
      }
      throw new Error('לא מוגדר API key לייצור תמונות — הוסף GOOGLE_SERVICE_ACCOUNT_JSON, IDEOGRAM_API_KEY או OPENAI_API_KEY');
    };

    let fallbackProvider: string | null = null;
    try {
      imageUrl = (await tryGenerate(provider)).url;
    } catch (firstErr: any) {
      // Gemini quota → silently retry with Ideogram so the user still gets an image.
      const isQuota = /quota|billing|rate.?limit|429/i.test(firstErr.message);
      if (provider === 'gemini' && isQuota && process.env.IDEOGRAM_API_KEY) {
        console.warn('[images] Gemini quota exhausted, falling back to Ideogram');
        try {
          imageUrl = (await tryGenerate('ideogram')).url;
          fallbackProvider = 'ideogram';
        } catch (genErr: any) {
          await supabase.rpc('refund_credits', { p_user_id: user.id, p_action: action, p_cost: cost });
          return NextResponse.json({ error: genErr.message, refunded: cost }, { status: 502 });
        }
      } else {
        // Non-fallback failure (or no Ideogram key) — refund and surface the error.
        await supabase.rpc('refund_credits', { p_user_id: user.id, p_action: action, p_cost: cost });
        return NextResponse.json({ error: firstErr.message, refunded: cost }, { status: 502 });
      }
    }

    // Save to DB with parent link if edit/adapt
    const promptTag = isAdapt ? `[adapt:${aspectRatio}]` : isEdit ? '[edit]' : '';
    const { error: insertErr } = await supabase.from('generated_images').insert({
      user_id:         user.id,
      client_id:       activeClientId ?? null,
      prompt:          promptTag ? `${promptTag} ${finalPrompt}` : finalPrompt,
      image_url:       imageUrl,
      provider:        fallbackProvider ?? provider,
      style,
      aspect_ratio:    aspectRatio,
      parent_image_id: parentImageId ?? null,
      edit_prompt:     isEdit ? editPrompt : isAdapt ? `Adapt to ${aspectRatio}` : null,
    });

    // Tagged write-through: record the generated creative as an artifact (best-effort).
    // Skip edits/adapts — those are derivatives of an existing creative, not fresh generations.
    if (activeClientId && !isEdit && !isAdapt) {
      await recordArtifactWith(createAdminClient, {
        clientId:    activeClientId,
        ownerUserId: user.id,
        type:        'creative_image',
        content:     { url: imageUrl, prompt: finalPrompt },
        generatedFrom: { provider: fallbackProvider ?? provider, model: GEMINI_MODEL },
      });
    }

    const baseResponse = {
      url: imageUrl,
      credits: deductResult.credits,
      ...(fallbackProvider ? { fallbackProvider, notice: `Gemini quota מוצה — נוצר עם ${fallbackProvider}` } : {}),
    };

    if (insertErr) {
      console.error('[images] DB insert failed:', insertErr);
      const responseBody = { ...baseResponse, warning: 'התמונה נוצרה אך לא נשמרה בהיסטוריה' };
      if (idemKey) setIdempotent(user.id, idemKey, responseBody, 200);
      return NextResponse.json(responseBody);
    }

    if (idemKey) setIdempotent(user.id, idemKey, baseResponse, 200);
    return NextResponse.json(baseResponse);
  } catch (err: any) {
    console.error('[images] Unexpected error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET /api/images — list generated images
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('generated_images')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  return NextResponse.json(data ?? []);
}
