-- ============================================================
-- 021_client_core -- ROLLBACK (down-migration)
--
-- Reverses 021_client_core.sql. Drops the GIN index and the three client-core
-- columns from meta_clients.
--
-- Safe: these columns are additive; the legacy sources (briefs.avatar and
-- brief_analyses) were never modified by 021, so dropping the core loses no
-- canonical data. Admin/user login and meta_clients owner RLS are untouched.
--
-- ROLLBACK ONLY -- do NOT run during a forward apply.
-- Apply MANUALLY in the Supabase SQL Editor (H1).
-- ============================================================

drop index if exists public.meta_clients_avatar_idx;

alter table public.meta_clients
  drop column if exists business_analysis,
  drop column if exists avatar,
  drop column if exists core_generated_at;
