import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CREDIT_COSTS } from '@/types';
import { checkRateLimit } from '@/lib/rate-limit';
import { callVertexImageGen } from '@/lib/vertex-ai';

// "Nano Banana" — Google's image-gen Gemini models. Pro is the newer, higher-quality one.
// Available models (early 2026): gemini-2.5-flash-image, gemini-3-pro-image-preview, gemini-3.1-flash-image-preview
const GEMINI_MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';
const GEMINI_BUCKET = 'generated-images';

const GEMINI_ASPECT: Record<string, string> = {
  'ASPECT_1_1':  '1:1',
  'ASPECT_16_9': '16:9',
  'ASPECT_9_16': '9:16',
  'ASPECT_4_5':  '3:4',
  'ASPECT_4_3':  '4:3',
  'ASPECT_3_4':  '3:4',
};

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

async function uploadToStorage(supabase: SupabaseClient, userId: string, base64: string, mimeType: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');
  const ext = mimeType.split('/')[1] || 'png';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(GEMINI_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(GEMINI_BUCKET).getPublicUrl(path);
  return data.publicUrl;
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

    const isEdit  = mode === 'edit';
    const isAdapt = mode === 'adapt';
    const action  = isAdapt ? 'img_adapt' : isEdit ? 'img_edit' : 'post';
    const cost    = CREDIT_COSTS[action];

    const finalPrompt = isAdapt
      ? `Re-render this exact scene in a new aspect ratio (${aspectRatio}). Preserve subject, colors, and composition.`
      : isEdit ? editPrompt : prompt;
    if (!finalPrompt) return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });
    if (finalPrompt.length > 2000) return NextResponse.json({ error: 'Prompt ארוך מדי (מקסימום 2000 תווים)' }, { status: 400 });
    if ((isEdit || isAdapt) && !parentImageUrl) return NextResponse.json({ error: 'Missing parentImageUrl' }, { status: 400 });

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
        return { url: await generateGemini(supabase, user.id, finalPrompt, aspectRatio) };
      }
      if (p === 'ideogram' && process.env.IDEOGRAM_API_KEY) {
        return { url: await generateIdeogram(finalPrompt, aspectRatio, style) };
      }
      if (process.env.OPENAI_API_KEY) {
        return { url: await generateDallE(finalPrompt, dalleSize[aspectRatio] || '1024x1024') };
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
      prompt:          promptTag ? `${promptTag} ${finalPrompt}` : finalPrompt,
      image_url:       imageUrl,
      provider:        fallbackProvider ?? provider,
      style,
      aspect_ratio:    aspectRatio,
      parent_image_id: parentImageId ?? null,
      edit_prompt:     isEdit ? editPrompt : isAdapt ? `Adapt to ${aspectRatio}` : null,
    });

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
