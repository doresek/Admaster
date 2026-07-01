-- ============================================================
-- 031_reconcile_meta_connections_report_shares
-- ADDITIVE / REVERSIBLE. Creates two tables the merged code depends on but that
-- were NEVER applied to prod (verified 2026-07-01: both 404/PGRST205):
--   * meta_connections  (historical 019 — breaks Meta OAuth connect flow)
--   * report_shares     (historical 025 — breaks /report/<token> share-link)
-- Forward-correct shape: client_id references public.clients(id) (the v2 identity
-- table), NOT legacy meta_clients — so new clients-only rows work. Columns match
-- what lib/meta-connections.ts and the report resolver actually read.
-- Reverse: 031_..._report_shares.down.sql
-- ============================================================

-- 1) meta_connections — optional Meta credential/asset for a client (agency-managed)
create table if not exists public.meta_connections (
  id                      uuid default uuid_generate_v4() primary key,
  client_id               uuid not null references public.clients(id) on delete cascade,
  agency_user_id          uuid not null references public.users(id) on delete cascade,
  token_encrypted         text,                       -- AES-256-GCM (lib/crypto); nullable for pending links
  meta_user_id            text,
  meta_user_name          text,
  pages                   jsonb default '[]'::jsonb,
  ad_accounts             jsonb default '[]'::jsonb,
  selected_page_id        text,
  selected_ad_account_id  text,
  status                  text default 'connected'
                            check (status in ('pending','connected','error','revoked')),
  connected_at            timestamptz default now(),
  updated_at              timestamptz default now()
);
create index if not exists idx_meta_connections_client on public.meta_connections(client_id);
create index if not exists idx_meta_connections_agency on public.meta_connections(agency_user_id);
alter table public.meta_connections enable row level security;
drop policy if exists meta_connections_own on public.meta_connections;
create policy meta_connections_own on public.meta_connections
  using (auth.uid() = agency_user_id) with check (auth.uid() = agency_user_id);
-- (the session-less connect callback writes the token via the SERVICE ROLE, which bypasses RLS)

-- 2) report_shares — client-facing ROI report share-link (/report/<token>)
create table if not exists public.report_shares (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid not null references public.users(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  token         text not null unique,
  period_start  date not null,
  period_end    date not null,
  report        jsonb,
  expires_at    timestamptz,
  created_at    timestamptz default now()
);
create index if not exists idx_report_shares_client on public.report_shares(client_id);
alter table public.report_shares enable row level security;
drop policy if exists report_shares_own on public.report_shares;
create policy report_shares_own on public.report_shares
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- (the public /report/<token> resolver reads by token via the SERVICE ROLE, bypassing RLS)
