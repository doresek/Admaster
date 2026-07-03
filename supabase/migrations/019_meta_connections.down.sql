-- ============================================================
-- 019_meta_connections -- ROLLBACK (down-migration)
--
-- Reverses 019_meta_connections.sql. Drops the child table (which also
-- removes the backfilled rows, the indexes, and the RLS policy via CASCADE).
--
-- Safe: meta_clients still holds the canonical legacy credential/asset columns
-- (019 only COPIED from them, it never removed them), so no data is lost by
-- dropping meta_connections before cutover. Existing admin/user login and the
-- meta_clients_own policy are untouched by this rollback.
--
-- ROLLBACK ONLY -- do NOT run during a forward apply.
-- Apply MANUALLY in the Supabase SQL Editor (H1).
-- ============================================================

drop table if exists public.meta_connections cascade;
