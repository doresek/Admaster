-- Reverse of 045_heartbeat_claim_uniq. Drops the claim arbiter index and the
-- period_key column, returning heartbeat_runs to its 039 shape. Safe/idempotent.
drop index if exists public.heartbeat_runs_claim_uniq;
alter table public.heartbeat_runs
  drop column if exists period_key;
