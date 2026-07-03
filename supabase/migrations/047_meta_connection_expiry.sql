-- ============================================================
-- 047_meta_connection_expiry — store Meta token expiry (bug #3 / C-06 pipe-health)
-- Additive. Pure ASCII. Idempotent. No destructive ops.
--
-- meta_connections.client_id already references public.clients (verified on prod —
-- migration 031 got the id-space right), so NO repoint is needed. The real gap is
-- that the OAuth callback never persisted the long-lived token's expiry, so the
-- readiness/pipe-health check can't tell a live token from an expired one. This adds
-- token_expires_at (NULL = long-lived / never-expiring, which is what a business
-- System-User token returns).
--
-- Reverse: 047_meta_connection_expiry.down.sql
-- ============================================================
begin;
alter table public.meta_connections
  add column if not exists token_expires_at timestamptz;
commit;

-- POST-VERIFY (read-only):
-- select column_name from information_schema.columns
--   where table_name='meta_connections' and column_name='token_expires_at';
