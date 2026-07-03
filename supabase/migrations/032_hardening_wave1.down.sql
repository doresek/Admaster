-- ============================================================
-- 032_hardening_wave1 — REVERSE (down). Pure ASCII. Idempotent.
-- ============================================================
begin;
drop function if exists public.check_rate_limit(text, int, int);
drop table if exists public.rate_limits;
drop function if exists public.claim_client_build(uuid, uuid, int);
alter table public.client_strategy drop column if exists core_building_at;
drop index if exists public.briefs_client_id_uniq;
commit;
