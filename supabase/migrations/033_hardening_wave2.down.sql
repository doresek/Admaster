-- ============================================================
-- 033_hardening_wave2 — REVERSE (down). Pure ASCII. Idempotent.
-- ============================================================
begin;
drop index if exists public.content_performance_window_uniq;
commit;
