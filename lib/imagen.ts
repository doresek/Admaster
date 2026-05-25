// ════════════════════════════════════════════
// Imagen 3 (Google AI Studio) — REST wrapper
// + Supabase Storage upload helper
// ════════════════════════════════════════════

import { createAdminClient } from '@/lib/supabase/server';
import type { ImagenAspectRatio } from '@/types';

export const IMAGEN_MODEL = 'imagen-3.0-generate-002';
export const IMAGEN_BUCKET = 'generated-images';

// Imagen accepts colon-separated ratios. Keep a mapping from the
// UI's ASPECT_X_Y enum to the API form + final pixel dimensions
// (Imagen 3 fixed output sizes).
const ASPECT_MAP: Record<ImagenAspectRatio, { api: string; width: number; height: number }> = {
  ASPECT_1_1:  { api: '1:1',  width: 1024, height: 1024 },
  ASPECT_16_9: { api: '16:9', width: 1408, height: 768  },
  ASPECT_9_16: { api: '9:16', width: 768,  height: 1408 },
  ASPECT_4_3:  { api: '4:3',  width: 1280, height: 896  },
  ASPECT_3_4:  { api: '3:4',  width: 896,  height: 1280 },
  // 4:5 isn't natively supported by Imagen 3 — fall back to 3:4 (closest portrait).
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGEN_MODEL}:predict?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: dim.api,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Imagen error (${res.status})`;
    throw new Error(msg);
  }

  const pred = data?.predictions?.[0];
  if (!pred?.bytesBase64Encoded) {
    // Imagen sometimes returns an empty predictions array when the prompt is filtered.
    throw new Error('Imagen לא החזיר תמונה — ייתכן שה-prompt נחסם על-ידי מסנן בטיחות');
  }

  return {
    base64:   pred.bytesBase64Encoded,
    mimeType: pred.mimeType || 'image/png',
    width:    dim.width,
    height:   dim.height,
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
