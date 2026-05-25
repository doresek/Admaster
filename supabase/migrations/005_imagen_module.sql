-- ============================================================
-- 005_imagen_module.sql
-- Extends `generated_images` table for the Imagen module:
--   - Link to a brief (forward-compat for brief→image workflows)
--   - Track model used (imagen-3.0-generate-002, dall-e-3, V_2, ...)
--   - Persist images in Supabase Storage instead of provider URLs
--     (DALL-E URLs expire in ~1h; Imagen returns base64)
--   - Capture cost charged and last error for debugging
--
-- Safe to run on a database that already has 001/002/003/004 applied.
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- ============================================================

-- 1) New columns on the existing generated_images table.
ALTER TABLE public.generated_images
  ADD COLUMN IF NOT EXISTS brief_id     uuid REFERENCES public.briefs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS model        text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS cost         int,
  ADD COLUMN IF NOT EXISTS error        text,
  ADD COLUMN IF NOT EXISTS width        int,
  ADD COLUMN IF NOT EXISTS height       int;

-- 2) Index for fast "all images for a brief" lookups.
CREATE INDEX IF NOT EXISTS idx_images_brief
  ON public.generated_images(brief_id)
  WHERE brief_id IS NOT NULL;

-- 3) Index for "images by provider/model" stats.
CREATE INDEX IF NOT EXISTS idx_images_model
  ON public.generated_images(model)
  WHERE model IS NOT NULL;

-- ============================================================
-- MANUAL STEP — create the Storage bucket before deploying app code:
--
--   Supabase Dashboard → Storage → New bucket
--     name:   generated-images
--     public: true   (so img src=<publicUrl> works without signed URLs)
--
--   Then add a policy on storage.objects:
--     - INSERT: bucket_id = 'generated-images' AND auth.role() = 'authenticated'
--     - SELECT: bucket_id = 'generated-images'   (public read)
--
-- The /api/images route uploads via the service_role, so it bypasses
-- RLS — these policies are only relevant if the browser ever uploads
-- directly (it does not today).
-- ============================================================
