-- ============================================================
-- 006_avatar_v2.sql
-- Adds Avatar v2 JSONB storage to `briefs`.
-- v1 column (`avatar text`) is preserved → UI can fallback to v1.
-- Safe to run on a database that already has 001..004 applied.
-- (005 is reserved for the imagen track.)
-- ============================================================

ALTER TABLE public.briefs
  ADD COLUMN IF NOT EXISTS avatar_v2           jsonb,
  ADD COLUMN IF NOT EXISTS avatar_v2_meta      jsonb,
  ADD COLUMN IF NOT EXISTS avatar_generated_at timestamptz;

-- GIN index lets us filter/search inside the avatar_v2 JSONB later
-- (e.g. by awareness_level, market_sophistication_level, …)
CREATE INDEX IF NOT EXISTS briefs_avatar_v2_idx
  ON public.briefs USING gin (avatar_v2);

-- ============================================================
-- Verify:
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'briefs'
--     AND column_name IN ('avatar_v2','avatar_v2_meta','avatar_generated_at');
-- ============================================================
