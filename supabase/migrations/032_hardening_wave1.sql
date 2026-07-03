-- ============================================================
-- 032_hardening_wave1 — schema floor for the Wave-1 security/reliability fixes
-- Additive. Pure ASCII. Idempotent. No destructive ops. Safe to re-run.
--
-- Covers:
--   Q1  briefs(client_id) UNIQUE — the submit upsert onConflict:'client_id' needs it.
--       Prod already carries an undocumented `briefs_client_uniq`; this makes a fresh
--       rebuild from migrations agree with prod (drift fix). Multiple NULL client_ids
--       remain allowed (standard UNIQUE treats NULLs as distinct).
--   C1  client_strategy.core_building_at — per-client build claim (compare-and-set) so
--       concurrent brief submits cannot double-build the core / double-charge credits.
--   S3  rate_limits + check_rate_limit() — durable, cross-instance rate limiting to
--       replace the in-memory Map (ineffective on serverless).
--
-- Reverse (down): see 032_hardening_wave1.down.sql
-- ============================================================

-- ---- PREFLIGHT (read-only): run FIRST, expect zero rows. If any row is returned,
--      there is a duplicate non-null briefs.client_id and the unique index below will
--      fail — resolve the dupes before applying.
-- select client_id, count(*) from public.briefs
--  where client_id is not null group by client_id having count(*) > 1;

begin;

-- Q1 — unique on briefs(client_id) (non-null rows only; NULLs stay distinct/allowed)
create unique index if not exists briefs_client_id_uniq
  on public.briefs(client_id);

-- C1 — build-claim column (nullable; NULL = not building)
alter table public.client_strategy
  add column if not exists core_building_at timestamptz;

-- C1 — atomic per-client build claim. Ensures a client_strategy row exists, then
-- compare-and-sets core_building_at to now ONLY when it is free (null) or stale.
-- Postgres re-evaluates the WHERE on the locked row under concurrency, so exactly
-- one of N concurrent callers wins. Returns TRUE iff this caller took the claim.
create or replace function public.claim_client_build(
  p_client_id uuid,
  p_owner uuid,
  p_ttl_seconds int default 600
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean;
begin
  insert into public.client_strategy (client_id, owner_user_id)
    values (p_client_id, p_owner)
  on conflict (client_id) do nothing;

  update public.client_strategy
     set core_building_at = now()
   where client_id = p_client_id
     and owner_user_id = p_owner
     and (core_building_at is null
          or core_building_at < now() - make_interval(secs => p_ttl_seconds))
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end;
$$;

grant execute on function public.claim_client_build(uuid, uuid, int)
  to authenticated, service_role;

-- S3 — durable rate-limit store (accessed only via the SECURITY DEFINER RPC below)
create table if not exists public.rate_limits (
  key          text primary key,
  count        int not null default 0,
  window_start timestamptz not null default now()
);
alter table public.rate_limits enable row level security;
-- No policy: direct access denied to anon/authenticated; only the DEFINER RPC touches it.

-- Atomic fixed-window limiter. Returns TRUE when the request is allowed (count <= max).
create or replace function public.check_rate_limit(
  p_key text,
  p_max int,
  p_window_seconds int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  insert into public.rate_limits (key, count, window_start)
    values (p_key, 1, now())
  on conflict (key) do update set
    count = case
      when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
      then 1
      else public.rate_limits.count + 1
    end,
    window_start = case
      when public.rate_limits.window_start < now() - make_interval(secs => p_window_seconds)
      then now()
      else public.rate_limits.window_start
    end
  returning public.rate_limits.count <= p_max into v_allowed;
  return coalesce(v_allowed, true);
end;
$$;

grant execute on function public.check_rate_limit(text, int, int)
  to anon, authenticated, service_role;

commit;

-- ---- POST-VERIFY (read-only) ----
-- select indexname from pg_indexes where tablename='briefs' and indexname='briefs_client_id_uniq';
-- select column_name from information_schema.columns
--   where table_name='client_strategy' and column_name='core_building_at';
-- select public.check_rate_limit('selfcheck:verify', 5, 60); -- expect: t (allowed)
