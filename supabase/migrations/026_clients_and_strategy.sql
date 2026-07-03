-- ============================================================
-- 026_clients_and_strategy  (F1)  — client-model-v2 identity + synthesized snapshot
-- Foundation step 1 of 3 (F1 -> F2 -> F3). Additive. Pure ASCII. Idempotent.
-- Reverse: drop table public.client_strategy; drop table public.clients;
-- ============================================================

create table if not exists public.clients (
  id                   uuid primary key default uuid_generate_v4(),
  owner_user_id        uuid not null references public.users(id) on delete cascade,
  name                 text not null,
  email                text,
  phone                text,
  company              text,
  industry             text,
  notes                text,
  connect_token        text,
  connect_expires_at   timestamptz,
  connect_consumed_at  timestamptz,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);
create index if not exists idx_clients_owner on public.clients(owner_user_id);
create unique index if not exists idx_clients_connect_token
  on public.clients(connect_token) where connect_token is not null;
alter table public.clients enable row level security;
drop policy if exists clients_own on public.clients;
create policy clients_own on public.clients
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

create table if not exists public.client_strategy (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  owner_user_id     uuid not null references public.users(id) on delete cascade,
  business_analysis jsonb,
  avatar            jsonb,
  core_generated_at timestamptz,
  updated_at        timestamptz default now(),
  unique (client_id)
);
create index if not exists idx_client_strategy_owner on public.client_strategy(owner_user_id);
alter table public.client_strategy enable row level security;
drop policy if exists client_strategy_own on public.client_strategy;
create policy client_strategy_own on public.client_strategy
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
