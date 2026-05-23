import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CREDIT_COSTS } from '@/types';

// Cost for image generation (add to types)
const IMAGE_COST = 5;

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
        aspect_ratio: aspectRatio, // ASPECT_1_1, ASPECT_16_9, ASPECT_9_16
        model: 'V_2',
        style_type: style, // REALISTIC, DESIGN, ILLUSTRATION
        magic_prompt_option: 'AUTO',
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Ideogram error');
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
      model: 'dall-e-3',
      prompt,
      n: 1,
      size, // 1024x1024, 1792x1024, 1024x1792
      quality: 'hd',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'DALL-E error');
  return data.data?.[0]?.url;
}

// POST /api/images
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { prompt, aspectRatio = 'ASPECT_1_1', style = 'REALISTIC', provider = 'ideogram' } = await req.json();
    if (!prompt) return NextResponse.json({ error: 'Missing prompt' }, { status: 400 });

    // Deduct credits
    const { data: deductResult } = await supabase.rpc('deduct_credits', {
      p_user_id: user.id,
      p_action: 'post', // reuse post cost for now
      p_cost: IMAGE_COST,
    });
    if (!deductResult?.success) {
      return NextResponse.json({ error: 'insufficient_credits' }, { status: 402 });
    }

    // Map aspect ratio to DALL-E size
    const dalleSize: Record<string, string> = {
      'ASPECT_1_1': '1024x1024',
      'ASPECT_16_9': '1792x1024',
      'ASPECT_9_16': '1024x1792',
    };

    let imageUrl: string;

    if (provider === 'ideogram' && process.env.IDEOGRAM_API_KEY) {
      imageUrl = await generateIdeogram(prompt, aspectRatio, style);
    } else if (process.env.OPENAI_API_KEY) {
      imageUrl = await generateDallE(prompt, dalleSize[aspectRatio] || '1024x1024');
    } else {
      throw new Error('לא מוגדר API key לייצור תמונות — הוסף IDEOGRAM_API_KEY או OPENAI_API_KEY');
    }

    // Save to DB
    await supabase.from('generated_images').insert({
      user_id: user.id, prompt, image_url: imageUrl,
      provider, style, aspect_ratio: aspectRatio,
    });

    return NextResponse.json({ url: imageUrl, credits: deductResult.credits });
  } catch (err: any) {
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
