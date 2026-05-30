// Vertex AI auth + image generation helper.
// Why this exists: Google AI Studio (generativelanguage.googleapis.com + API key)
// routes image-gen models through a free tier with `limit: 0` for new accounts.
// Vertex AI lets us pay for image generation via Google Cloud billing.
import { JWT } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

let cachedClient: JWT | null = null;
let cachedToken: { value: string; expiresAt: number } | null = null;

function parseCredentials(): { client_email: string; private_key: string; project_id: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON env var');
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('Service account JSON is missing client_email or private_key');
    }
    return parsed;
  } catch (e: any) {
    throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_JSON: ${e.message}`);
  }
}

function getClient(): JWT {
  if (cachedClient) return cachedClient;
  const creds = parseCredentials();
  cachedClient = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
  });
  return cachedClient;
}

async function getAccessToken(): Promise<string> {
  // Reuse cached token until 60s before expiry.
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const client = getClient();
  const { token, res } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain Vertex AI access token');
  // Token TTL is ~3600s; cache it
  const expiresIn = (res as any)?.data?.expires_in ?? 3600;
  cachedToken = { value: token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

/**
 * Map our internal ASPECT_* tokens to Vertex/Gemini aspect-ratio strings.
 * Shared by the image route and the smart pipeline so the mapping lives in one place.
 * Note: 4:5 has no native Gemini ratio — we approximate with the closest portrait 3:4.
 */
export const GEMINI_ASPECT: Record<string, string> = {
  ASPECT_1_1:  '1:1',
  ASPECT_16_9: '16:9',
  ASPECT_9_16: '9:16',
  ASPECT_4_5:  '3:4',
  ASPECT_4_3:  '4:3',
  ASPECT_3_4:  '3:4',
};

export function getProjectId(): string {
  return process.env.GOOGLE_CLOUD_PROJECT
    || parseCredentials().project_id;
}

export function getLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
}

/**
 * Wrap Hebrew text runs in straight double quotes so Gemini renders them verbatim
 * in the image. Standard prompt-engineering trick — quoted text gets reproduced
 * letter-for-letter instead of being "interpreted" by the model.
 *
 * Skips when the prompt is mostly Hebrew (descriptive, not meant to appear in image).
 * Skips Hebrew already inside quotes (no double-wrapping).
 * Converts Hebrew gershayim (״...״) to ASCII quotes ("...") — Gemini handles ASCII better.
 */
export function wrapHebrewForGemini(prompt: string): string {
  // If the prompt is dominantly Hebrew, assume it's a descriptive brief, not text-on-image.
  const letters = prompt.replace(/[^\p{L}]/gu, '');
  const hebrewLetters = (prompt.match(/[֐-׿]/g) || []).length;
  const isMostlyHebrew = letters.length > 0 && hebrewLetters / letters.length > 0.6;
  if (isMostlyHebrew) return prompt;

  // Normalize Hebrew gershayim to ASCII straight quotes.
  const normalized = prompt.replace(/[״״]/g, '"');

  // Split on quoted segments so we never re-wrap text already in quotes.
  // The capturing group keeps the quoted parts in the output array.
  const segments = normalized.split(/("[^"]*")/);
  const HEBREW_RUN = /[֐-׿]+(?:\s+[֐-׿]+)*/g;

  return segments
    .map((seg, i) => {
      // Odd indices = inside quotes; leave as-is.
      if (i % 2 === 1) return seg;
      // Even indices = outside any quotes; wrap any Hebrew run we find.
      return seg.replace(HEBREW_RUN, (m) => `"${m}"`);
    })
    .join('');
}

export interface VertexImageInput {
  prompt: string;
  /** Vertex aspect ratio: "1:1", "16:9", "9:16", "3:4", "4:3" */
  aspectRatio?: string;
  /** Inline source image for edit/remix flows (base64 + mime). */
  sourceImage?: { base64: string; mimeType: string };
  /** Model id, e.g. "gemini-2.5-flash-image" or "gemini-3-pro-image-preview" */
  model?: string;
}

export interface VertexImageResult {
  /** Base64-encoded image bytes returned by the model. */
  base64: string;
  /** Image MIME type (e.g. "image/png"). */
  mimeType: string;
}

/**
 * Call Vertex AI Gemini image-generation. Returns base64 + mime.
 * The caller is responsible for persisting the image (e.g. Supabase Storage).
 */
export async function callVertexImageGen(input: VertexImageInput): Promise<VertexImageResult> {
  const model = input.model || process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
  const project = getProjectId();
  const location = getLocation();
  const token = await getAccessToken();

  // Auto-quote Hebrew text so Gemini renders it verbatim in the image.
  const promptText = wrapHebrewForGemini(input.prompt);

  const parts: Array<Record<string, unknown>> = [];
  if (input.sourceImage) {
    parts.push({ inlineData: { mimeType: input.sourceImage.mimeType, data: input.sourceImage.base64 } });
  }
  parts.push({ text: promptText });

  const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        ...(input.aspectRatio ? { imageConfig: { aspectRatio: input.aspectRatio } } : {}),
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Vertex AI error (${res.status})`;
    throw new Error(msg);
  }

  const cand = data?.candidates?.[0];
  const imagePart = cand?.content?.parts?.find((p: any) => p.inlineData);
  if (!imagePart?.inlineData?.data) {
    const reason = cand?.finishReason || 'no image part';
    throw new Error(`Vertex AI returned no image: ${reason}`);
  }

  return {
    base64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || 'image/png',
  };
}
