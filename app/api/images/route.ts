import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CREDIT_COSTS } from '@/types';
import { checkRateLimit } from '@/lib/rate-limit';

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
    const { mode, prompt, aspectRatio = 'ASPECT_1_1', style = 'REALISTIC', provider = 'ideogram',
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

    try {
      if (isEdit || isAdapt) {
        if (provider === 'ideogram' && process.env.IDEOGRAM_API_KEY) {
          imageUrl = await remixIdeogram(parentImageUrl, finalPrompt, aspectRatio, style);
        } else if (process.env.OPENAI_API_KEY) {
          const guided = `Based on this scene: a refined version with the following changes: ${finalPrompt}. Keep the original composition.`;
          imageUrl = await generateDallE(guided, dalleSize[aspectRatio] || '1024x1024');
        } else {
          throw new Error('לא מוגדר API key לעריכת תמונות — הוסף IDEOGRAM_API_KEY (עדיף) או OPENAI_API_KEY');
        }
      } else {
        if (provider === 'ideogram' && process.env.IDEOGRAM_API_KEY) {
          imageUrl = await generateIdeogram(finalPrompt, aspectRatio, style);
        } else if (process.env.OPENAI_API_KEY) {
          imageUrl = await generateDallE(finalPrompt, dalleSize[aspectRatio] || '1024x1024');
        } else {
          throw new Error('לא מוגדר API key לייצור תמונות — הוסף IDEOGRAM_API_KEY או OPENAI_API_KEY');
        }
      }
    } catch (genErr: any) {
      // Provider failed — refund credits so the user isn't charged for nothing
      await supabase.rpc('refund_credits', {
        p_user_id: user.id, p_action: action, p_cost: cost,
      });
      return NextResponse.json({ error: genErr.message, refunded: cost }, { status: 502 });
    }

    // Save to DB with parent link if edit/adapt
    const promptTag = isAdapt ? `[adapt:${aspectRatio}]` : isEdit ? '[edit]' : '';
    const { error: insertErr } = await supabase.from('generated_images').insert({
      user_id:         user.id,
      prompt:          promptTag ? `${promptTag} ${finalPrompt}` : finalPrompt,
      image_url:       imageUrl,
      provider,
      style,
      aspect_ratio:    aspectRatio,
      parent_image_id: parentImageId ?? null,
      edit_prompt:     isEdit ? editPrompt : isAdapt ? `Adapt to ${aspectRatio}` : null,
    });

    if (insertErr) {
      console.error('[images] DB insert failed:', insertErr);
      const responseBody = {
        url: imageUrl,
        credits: deductResult.credits,
        warning: 'התמונה נוצרה אך לא נשמרה בהיסטוריה',
      };
      if (idemKey) setIdempotent(user.id, idemKey, responseBody, 200);
      return NextResponse.json(responseBody);
    }

    const responseBody = { url: imageUrl, credits: deductResult.credits };
    if (idemKey) setIdempotent(user.id, idemKey, responseBody, 200);
    return NextResponse.json(responseBody);
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
