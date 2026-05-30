// Shared helper for persisting generated image bytes to Supabase Storage.
// Extracted from app/api/images/route.ts so both the single-shot route and the
// smart best-of-N pipeline upload through the exact same code path.
import type { SupabaseClient } from '@supabase/supabase-js';

export const GENERATED_IMAGES_BUCKET = 'generated-images';

/**
 * Upload base64 image bytes to the public `generated-images` bucket and return
 * the public URL. Path is namespaced per user: `${userId}/${ts}-${rand}.${ext}`.
 */
export async function uploadToStorage(
  supabase: SupabaseClient,
  userId: string,
  base64: string,
  mimeType: string,
): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');
  const ext = mimeType.split('/')[1] || 'png';
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(GENERATED_IMAGES_BUCKET)
    .upload(path, buffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
