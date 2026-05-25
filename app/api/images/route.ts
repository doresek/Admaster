import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CREDIT_COSTS, type ImagenAspectRatio, type ImageProvider } from '@/types';
import { generateImagen, uploadImageToStorage, IMAGEN_MODEL } from '@/lib/imagen';

// ── Provider: Ideogram (kept as fallback) ────────────────────
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
  return data.data?.[0]?.url as string;
}

// ── Provider: DALL-E (kept as fallback) ──────────────────────
async function generateDallE(prompt: string, size: string) {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size, quality: 'hd' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'DALL-E error');
  return data.data?.[0]?.url as string;
}

// Pick the default provider based on which API keys are configured.
function pickProvider(requested?: ImageProvider): ImageProvider {
  if (requested) return requested;
  if (process.env.GOOGLE_AI_API_KEY) return 'imagen';
  if (process.env.IDEOGRAM_API_KEY)  return 'ideogram';
  if (process.env.OPENAI_API_KEY)    return 'dalle';
  return 'imagen'; // will throw a clear "missing key" error downstream
}

// POST /api/images
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      prompt,
      aspectRatio = 'ASPECT_1_1',
      style = 'REALISTIC',
      provider: requestedProvider,
      briefId,
    } = body as {
      prompt:       string;
      aspectRatio?: ImagenAspectRatio;
      style?:       string;
      provider?:    ImageProvider;
      briefId?:     string;
    };

    if (!prompt) return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });

    const provider = pickProvider(requestedProvider);
    const cost = CREDIT_COSTS.image;

    // 1) Deduct credits atomically.
    const { data: deductResult } = await supabase.rpc('deduct_credits', {
      p_user_id: user.id,
      p_action:  'image',
      p_cost:    cost,
    });
    if (!deductResult?.success) {
      return NextResponse.json(
        { error: 'insufficient_credits', credits: deductResult?.credits ?? 0 },
        { status: 402 },
      );
    }

    // 2) Generate. Imagen returns base64 → uploaded to Storage. Other
    //    providers return remote URLs → stored as-is (legacy behavior).
    let imageUrl:    string;
    let storagePath: string | null = null;
    let model:       string | null = null;
    let width:       number | null = null;
    let height:      number | null = null;

    if (provider === 'imagen') {
      const result = await generateImagen(prompt, aspectRatio);
      const uploaded = await uploadImageToStorage(user.id, result.base64, result.mimeType);
      imageUrl    = uploaded.publicUrl;
      storagePath = uploaded.storagePath;
      model       = IMAGEN_MODEL;
      width       = result.width;
      height      = result.height;
    } else if (provider === 'ideogram') {
      if (!process.env.IDEOGRAM_API_KEY) {
        throw new Error('IDEOGRAM_API_KEY חסר — הוסף ל-.env.local');
      }
      imageUrl = await generateIdeogram(prompt, aspectRatio, style);
      model    = 'ideogram-v2';
    } else if (provider === 'dalle') {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY חסר — הוסף ל-.env.local');
      }
      const dalleSize: Record<string, string> = {
        ASPECT_1_1:  '1024x1024',
        ASPECT_16_9: '1792x1024',
        ASPECT_9_16: '1024x1792',
      };
      imageUrl = await generateDallE(prompt, dalleSize[aspectRatio] || '1024x1024');
      model    = 'dall-e-3';
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    // 3) Persist row.
    await supabase.from('generated_images').insert({
      user_id:      user.id,
      brief_id:     briefId ?? null,
      prompt,
      image_url:    imageUrl,
      storage_path: storagePath,
      provider,
      model,
      style,
      aspect_ratio: aspectRatio,
      cost,
      width,
      height,
    });

    return NextResponse.json({
      url:     imageUrl,
      credits: deductResult.credits,
      provider,
      model,
      width,
      height,
    });

  } catch (err: any) {
    console.error('[images route]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET /api/images?briefId=... — list generated images for current user.
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const briefId = req.nextUrl.searchParams.get('briefId');

  let q = supabase
    .from('generated_images')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (briefId) q = q.eq('brief_id', briefId);

  const { data } = await q;
  return NextResponse.json(data ?? []);
}
