-- ============================================================
-- 040_autonomy — the autonomy ladder (VISION-DEEP §1.4): per-client trust
-- level L0..L3, the caps that bound L2+, and an append-only event log so
-- graduation is EARNED and auditable ("3 שבועות ב-L1 עם 92% אישורים").
-- ADDITIVE / REVERSIBLE. RLS owner-only. Reverse: 040_autonomy.down.sql
-- ============================================================

-- One autonomy state per client. Level semantics (enforced in lib/autonomy):
--   L0 draft-only · L1 propose+approve (DEFAULT) · L2 act-within-caps · L3 autonomous
create table if not exists public.client_autonomy (
  id                  uuid primary key default uuid_generate_v4(),
  client_id           uuid not null unique references public.clients(id) on delete cascade,
  owner_user_id       uuid not null references public.users(id) on delete cascade,
  level               text not null default 'L1' check (level in ('L0','L1','L2','L3')),
  -- caps bounding L2/L3 action (ILS / percents); lib/autonomy owns the shape
  caps                jsonb not null default '{}'::jsonb,
  -- rolling approval stats (graduation inputs; maintained by lib/autonomy)
  approvals_total     int not null default 0,
  approvals_approved  int not null default 0,
  level_since         timestamptz not null default now(),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create index if not exists idx_client_autonomy_owner on public.client_autonomy(owner_user_id);
alter table public.client_autonomy enable row level security;
drop policy if exists client_autonomy_own on public.client_autonomy;
create policy client_autonomy_own on public.client_autonomy
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- Append-only audit: every route through the ladder is an event.
create table if not exists public.autonomy_events (
  id             uuid primary key default uuid_generate_v4(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  event          text not null check (event in
                   ('level_changed','action_proposed','action_approved','action_rejected',
                    'action_auto_executed','action_blocked','graduation_proposed')),
  from_level     text,
  to_level       text,
  action         jsonb,                        -- {kind, ref, params, rationale}
  reason         text,
  created_at     timestamptz default now()
);
create index if not exists idx_autonomy_events_client on public.autonomy_events(client_id, created_at desc);
create index if not exists idx_autonomy_events_owner  on public.autonomy_events(owner_user_id);
alter table public.autonomy_events enable row level security;
drop policy if exists autonomy_events_own on public.autonomy_events;
create policy autonomy_events_own on public.autonomy_events
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
