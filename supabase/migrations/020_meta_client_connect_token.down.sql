-- ============================================================
-- 020_meta_client_connect_token -- ROLLBACK (down-migration)
--
-- Reverses 020_meta_client_connect_token.sql. Drops the partial unique index
-- and the three connect-link columns from meta_clients.
--
-- Safe: these columns are additive and hold only on-demand connect tokens; no
-- other object depends on them. The pgcrypto extension is intentionally LEFT in
-- place (it is a shared, harmless prerequisite that other features may use --
-- dropping it could break unrelated objects). Admin/user login is untouched.
--
-- ROLLBACK ONLY -- do NOT run during a forward apply.
-- Apply MANUALLY in the Supabase SQL Editor (H1).
-- ============================================================

drop index if exists public.idx_meta_clients_connect_token;

alter table public.meta_clients
  drop column if exists connect_token,
  drop column if exists connect_expires_at,
  drop column if exists connect_consumed_at;
