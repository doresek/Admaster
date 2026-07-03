-- ============================================================
-- 039_heartbeat — the Marketing Heartbeat run ledger (VISION-DEEP §1.2).
-- ADDITIVE / REVERSIBLE. One table. Every tick (daily/weekly/monthly) for a
-- client is one row: claim → run → succeed/fail, with the actions taken and
-- their WHY recorded. Claim-lease semantics make ticks idempotent + crash-safe
-- (a stale lease is reclaimable). RLS owner-only per 030 conventions.
-- Reverse: 039_heartbeat.down.sql
-- ============================================================

create table if not exists public.heartbeat_runs (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  tick_type       text not null check (tick_type in ('daily','weekly','monthly')),
  status          text not null default 'claimed'
                    check (status in ('claimed','running','succeeded','failed','skipped')),
  -- why THIS client got attention this tick (C-06 score components snapshot)
  attention       jsonb not null default '{}'::jsonb,
  -- what the tick did: [{kind, ref, rationale, autonomy_route}] — the WHY-trail
  actions         jsonb not null default '[]'::jsonb,
  notes           jsonb not null default '[]'::jsonb,
  tokens_used     int,
  error           text,
  lease_until     timestamptz,                 -- claim lease; reclaimable when past
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz default now()
);
create index if not exists idx_heartbeat_client_tick on public.heartbeat_runs(client_id, tick_type, created_at desc);
create index if not exists idx_heartbeat_claims      on public.heartbeat_runs(status, lease_until);
create index if not exists idx_heartbeat_owner       on public.heartbeat_runs(owner_user_id);
alter table public.heartbeat_runs enable row level security;
drop policy if exists heartbeat_runs_own on public.heartbeat_runs;
create policy heartbeat_runs_own on public.heartbeat_runs
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
