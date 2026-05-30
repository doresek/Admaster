-- ============================================================
-- 009: Harden SECURITY DEFINER functions by pinning search_path.
--
-- get_approval_by_token() and respond_to_approval() are SECURITY
-- DEFINER and GRANTed to anon+authenticated. A definer function with a
-- mutable search_path is a known privilege-escalation vector (Supabase
-- linter: function_search_path_mutable): if a same-named object is
-- created in a schema that precedes `public` on the caller's path,
-- unqualified calls inside the function could resolve to it while
-- running with the owner's privileges.
--
-- Object references inside both functions are already schema-qualified,
-- so exploitability is low — this is defense-in-depth hardening.
--
-- ALTER FUNCTION ... SET search_path is idempotent. Safe to run on prod.
-- ============================================================

alter function public.get_approval_by_token(text)
  set search_path = public, pg_temp;

alter function public.respond_to_approval(text, text, text)
  set search_path = public, pg_temp;
