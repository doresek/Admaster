// lib/campaigns/creative-image.ts
//
// DORMANT-SAFE creative image generation for the paid-campaign path.
//
// The master-studio pipeline emits an image PROMPT (text), not a URL. Paid
// creatives therefore published a PLACEHOLDER_IMAGE. This module turns that
// prompt into a REAL, stored image — but ONLY when an image provider is
// configured. With no provider (dry-run / today's behaviour) it returns null
// and NEVER throws, so the caller falls back to the placeholder exactly as
// before.
//
// It REUSES the existing infra rather than reinventing it:
//   • lib/vertex-ai `callVertexImageGen`  — Vertex/Gemini (base64 bytes)
//   • lib/image-storage `uploadToStorage` — persist to the `generated-images`
//     bucket and hand back a public URL
// Ideogram / DALL·E return remote URLs, so we fetch their bytes and upload them
// to OUR bucket too (external URLs — DALL·E's especially — expire).
//
// The provider-selection order mirrors app/api/images/route.ts `tryGenerate`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { callVertexImageGen } from '@/lib/vertex-ai';
import { uploadToStorage } from '@/lib/image-storage';

/** Raw image bytes a generator returns before we persist them. */
export interface CreativeImageBytes {
  base64: string;
  mimeType: string;
}

/** Injectable generator: prompt + aspect ratio → bytes (or null to skip). */
export type CreativeImageGenerator = (
  prompt: string,
  aspectRatio: string,
) => Promise<CreativeImageBytes | null>;

export interface CreativeImageDeps {
  /**
   * Override the byte generator (tests inject a fake so nothing hits the
   * network). When provided, it is used regardless of configured env keys.
   */
  generate?: CreativeImageGenerator;
}

export interface CreativeImageOptions {
  /** Vertex-style aspect ratio ("1:1", "16:9", ...). Default: feed-ad square. */
  aspectRatio?: string;
  deps?: CreativeImageDeps;
}

// Vertex/Gemini takes ratios like "1:1" directly; the other providers use their
// own vocabulary, mapped from the same canonical ratio here.
const IDEOGRAM_ASPECT: Record<string, string> = {
  '1:1': 'ASPECT_1_1',
  '16:9': 'ASPECT_16_9',
  '9:16': 'ASPECT_9_16',
  '4:3': 'ASPECT_4_3',
  '3:4': 'ASPECT_3_4',
};

const DALLE_SIZE: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1792x1024',
  '9:16': '1024x1792',
};

/** True when ANY supported image provider is configured via env. */
export function hasImageProvider(): boolean {
  return !!(
    process.env.GOOGLE_AI_API_KEY ||           // Nano Banana 2 via the Gemini API (preferred)
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    process.env.IDEOGRAM_API_KEY ||
    process.env.OPENAI_API_KEY
  );
}

/** Fetch a remote provider URL and return its bytes as base64 + mime. */
async function fetchAsBase64(url: string): Promise<CreativeImageBytes> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not fetch generated image (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { base64: buf.toString('base64'), mimeType: res.headers.get('content-type') || 'image/png' };
}

async function ideogramBytes(prompt: string, aspectRatio: string): Promise<CreativeImageBytes> {
  const res = await fetch('https://api.ideogram.ai/generate', {
    method: 'POST',
    headers: { 'Api-Key': process.env.IDEOGRAM_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_request: {
        prompt,
        aspect_ratio: IDEOGRAM_ASPECT[aspectRatio] || 'ASPECT_1_1',
        model: 'V_2',
        style_type: 'REALISTIC',
        magic_prompt_option: 'AUTO',
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Ideogram error (${res.status})`);
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error('Ideogram returned no image');
  return fetchAsBase64(url);
}

async function openaiBytes(prompt: string, aspectRatio: string): Promise<CreativeImageBytes> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: DALLE_SIZE[aspectRatio] || '1024x1024', quality: 'hd' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `DALL-E error (${res.status})`);
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error('DALL-E returned no image');
  return fetchAsBase64(url);
}

/**
 * Nano Banana (Gemini 2.5 Flash Image) / Nano Banana 2 (gemini-3-pro-image) via the
 * STANDARD Gemini API + GOOGLE_AI_API_KEY — no Vertex / GCP service account needed.
 * NOTE: image generation requires a BILLED Gemini API project; the free tier returns
 * HTTP 429 "quota exceeded" (limit:0 for images), which the caller handles as a
 * dormant null → placeholder. Once billing is enabled on the key, real images flow.
 */
async function geminiApiBytes(prompt: string, aspectRatio: string): Promise<CreativeImageBytes> {
  const key = process.env.GOOGLE_AI_API_KEY!;
  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image'; // Nano Banana 2
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}\n\nOutput a single image with aspect ratio ${aspectRatio}.` }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Gemini image error (${res.status})`;
    if (res.status === 429) throw new Error(`${msg} — enable billing on the Gemini API to generate images`);
    throw new Error(msg);
  }
  const parts: Array<{ inlineData?: { data?: string; mimeType?: string } }> =
    data?.candidates?.[0]?.content?.parts || [];
  const inline = parts.find((p) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error('Gemini returned no image');
  return { base64: inline.data, mimeType: inline.mimeType || 'image/png' };
}

/** Default provider selection — Nano Banana (Gemini API) first, then the rest. */
async function defaultGenerate(prompt: string, aspectRatio: string): Promise<CreativeImageBytes | null> {
  if (process.env.GOOGLE_AI_API_KEY) {
    return geminiApiBytes(prompt, aspectRatio);
  }
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return callVertexImageGen({ prompt, aspectRatio, model: process.env.GEMINI_IMAGE_MODEL });
  }
  if (process.env.IDEOGRAM_API_KEY) {
    return ideogramBytes(prompt, aspectRatio);
  }
  if (process.env.OPENAI_API_KEY) {
    return openaiBytes(prompt, aspectRatio);
  }
  return null;
}

/**
 * Turn an image prompt into a stored, public creative-image URL.
 *
 * DORMANT-SAFE: returns `null` (never throws) when no provider is configured OR
 * when generation/upload fails — the caller then falls back to the placeholder.
 * Only when a provider IS configured (or a generator is injected) does it
 * generate bytes, upload them to the `generated-images` bucket, and return the
 * public URL.
 */
export async function generateAndStoreCreativeImage(
  supabase: SupabaseClient,
  ownerUserId: string,
  prompt: string,
  opts: CreativeImageOptions = {},
): Promise<string | null> {
  const injected = opts.deps?.generate;
  // No injected generator AND no provider configured → stay dormant.
  if (!injected && !hasImageProvider()) return null;
  if (!prompt || !prompt.trim()) return null;

  const generate = injected ?? defaultGenerate;
  const aspectRatio = opts.aspectRatio || '1:1';

  try {
    const bytes = await generate(prompt, aspectRatio);
    if (!bytes?.base64) return null;
    return await uploadToStorage(supabase, ownerUserId, bytes.base64, bytes.mimeType || 'image/png');
  } catch (err) {
    // Never block the campaign on image failure — placeholder fallback covers it.
    console.error('[creative-image] generation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
