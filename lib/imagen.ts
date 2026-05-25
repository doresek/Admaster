// ════════════════════════════════════════════
// Gemini 2.5 Flash Image (Google AI Studio) — REST wrapper
// + Supabase Storage upload helper
//
// NOTE: We previously used `imagen-3.0-generate-002`, but that model is
// only reachable via Vertex AI (service-account auth). The Google AI
// Studio API key path (v1beta) returns 404 for it. `gemini-2.5-flash-image-preview`
// is available with an API key, but its output is effectively 1024×1024 only —
// it does NOT honor aspect-ratio hints today. The UI still lets the user pick
// 16:9 / 9:16 / 4:3 / 3:4 / 4:5, but the model returns square images for now.
// TODO: bring back full aspect-ratio support by adding a Vertex AI path for Imagen 3.
// ════════════════════════════════════════════

import { createAdminClient } from '@/lib/supabase/server';
import type { ImagenAspectRatio } from '@/types';

export const IMAGEN_MODEL = 'gemini-2.5-flash-image-preview';
export const IMAGEN_BUCKET = 'generated-images';

// Kept for downstream display/metadata. The `api` field is unused right now
// because gemini-2.5-flash-image-preview ignores aspectRatio — every response
// comes back ~1024×1024 regardless. Once we move to Vertex/Imagen 3 we'll
// wire this back into the request body.
const ASPECT_MAP: Record<ImagenAspectRatio, { api: string; width: number; height: number }> = {
  ASPECT_1_1:  { api: '1:1',  width: 1024, height: 1024 },
  ASPECT_16_9: { api: '16:9', width: 1408, height: 768  },
  ASPECT_9_16: { api: '9:16', width: 768,  height: 1408 },
  ASPECT_4_3:  { api: '4:3',  width: 1280, height: 896  },
  ASPECT_3_4:  { api: '3:4',  width: 896,  height: 1280 },
  ASPECT_4_5:  { api: '3:4',  width: 896,  height: 1280 },
};

export interface ImagenResult {
  base64:   string;
  mimeType: string;
  width:    number;
  height:   number;
}

export async function generateImagen(
  prompt: string,
  aspectRatio: ImagenAspectRatio,
): Promise<ImagenResult> {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_AI_API_KEY חסר — הוסף ל-.env.local. השג מ-https://aistudio.google.com/apikey');
  }

  const dim = ASPECT_MAP[aspectRatio] ?? ASPECT_MAP.ASPECT_1_1;

  // gemini-2.5-flash-image-preview uses the generateContent endpoint (not :predict)
  // and returns the image as an inlineData part on the candidate's content.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Imagen error (${res.status})`;
    throw new Error(msg);
  }

  // Walk the candidate parts looking for the first inlineData blob.
  const parts: Array<{ inlineData?: { data?: string; mimeType?: string } }> =
    data?.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find((p) => p.inlineData?.data);

  if (!imgPart?.inlineData?.data) {
    // Safety filters or text-only response.
    const blockReason =
      data?.promptFeedback?.blockReason ||
      data?.candidates?.[0]?.finishReason;
    throw new Error(
      blockReason
        ? `Imagen לא החזיר תמונה (${blockReason}) — ייתכן שה-prompt נחסם על-ידי מסנן בטיחות`
        : 'Imagen לא החזיר תמונה — ייתכן שה-prompt נחסם על-ידי מסנן בטיחות',
    );
  }

  // gemini-2.5-flash-image-preview returns ~1024×1024 regardless of the
  // requested aspect ratio. Report the actual output size, not the
  // requested one, so DB rows reflect reality.
  return {
    base64:   imgPart.inlineData.data,
    mimeType: imgPart.inlineData.mimeType || 'image/png',
    width:    1024,
    height:   1024,
  };
}

// Upload a base64-encoded image to Supabase Storage and return both
// the storage path and a public URL. Uses the admin (service_role)
// client so it bypasses RLS — caller is responsible for auth checks.
export async function uploadImageToStorage(
  userId: string,
  base64: string,
  mimeType: string,
): Promise<{ storagePath: string; publicUrl: string }> {
  const admin = createAdminClient();

  const ext = mimeType === 'image/jpeg' ? 'jpg' : 'png';
  const storagePath = `${userId}/${Date.now()}-${cryptoRandom()}.${ext}`;
  const buffer = Buffer.from(base64, 'base64');

  const { error: uploadErr } = await admin.storage
    .from(IMAGEN_BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

  if (uploadErr) {
    throw new Error(`Storage upload נכשל: ${uploadErr.message}`);
  }

  const { data: pub } = admin.storage.from(IMAGEN_BUCKET).getPublicUrl(storagePath);
  return { storagePath, publicUrl: pub.publicUrl };
}

function cryptoRandom(): string {
  // 8 hex chars — enough entropy when combined with userId + timestamp.
  return Math.random().toString(16).slice(2, 10);
}
