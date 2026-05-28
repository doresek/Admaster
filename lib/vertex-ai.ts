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

export function getProjectId(): string {
  return process.env.GOOGLE_CLOUD_PROJECT
    || parseCredentials().project_id;
}

export function getLocation(): string {
  return process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
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

  const parts: Array<Record<string, unknown>> = [];
  if (input.sourceImage) {
    parts.push({ inlineData: { mimeType: input.sourceImage.mimeType, data: input.sourceImage.base64 } });
  }
  parts.push({ text: input.prompt });

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
