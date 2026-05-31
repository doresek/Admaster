-- ============================================================
-- 011: Pin search_path on the SECURITY DEFINER functions added in 010.
--
-- 010 created unread_notif_count() and handle_new_user_settings() as
-- SECURITY DEFINER without a fixed search_path — the same
-- privilege-escalation vector (Supabase linter: function_search_path_mutable)
-- that the parallel session's 009 hardened for get_approval_by_token /
-- respond_to_approval. Closing it here for consistency.
--
-- Object references inside both functions are already schema-qualified,
-- so exploitability is low — defense-in-depth.
--
-- ALTER FUNCTION ... SET search_path is idempotent. Safe to run on prod.
-- ============================================================

alter function public.unread_notif_count(uuid)
  set search_path = public, pg_temp;

alter function public.handle_new_user_settings()
  set search_path = public, pg_temp;
