-- ============================================================
-- 008_google_ads_oauth.sql
-- Google Ads OAuth (read-only) connections.
-- Stores a long-lived refresh_token per (user, Google account) so
-- the app can mint short-lived access tokens for the Google Ads API.
-- Safe to run on a database that already has 001..004 applied.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Table
-- ────────────────────────────────────────────────────────────
create table if not exists public.google_ads_connections (
  id                uuid default uuid_generate_v4() primary key,
  user_id           uuid references public.users(id) on delete cascade not null,
  -- OAuth credentials. Plaintext + RLS, mirroring meta_clients.token.
  -- TODO: move to Supabase Vault / pgsodium before production rollout.
  refresh_token     text not null,
  -- Google account identifiers (from userinfo endpoint after callback)
  google_user_id    text,
  google_user_email text,
  -- Cache of customer accounts returned by customers:listAccessibleCustomers.
  -- Refreshed via /api/google-ads/accounts; shape: [{ "id": "1234567890" }, ...]
  customer_ids      jsonb default '[]'::jsonb not null,
  status            text  default 'connected' not null
                    check (status in ('connected','error','revoked')),
  last_synced_at    timestamptz,
  connected_at      timestamptz default now() not null,
  updated_at        timestamptz default now() not null
);

-- Prevent duplicate rows for the same (user, Google account) — the OAuth
-- callback upserts on this pair so re-connecting refreshes the token row.
create unique index if not exists google_ads_connections_user_google_uniq
  on public.google_ads_connections(user_id, google_user_id)
  where google_user_id is not null;

create index if not exists idx_google_ads_connections_user
  on public.google_ads_connections(user_id);

-- ────────────────────────────────────────────────────────────
-- 2. RLS — own rows only (same shape as meta_clients_own)
-- ────────────────────────────────────────────────────────────
alter table public.google_ads_connections enable row level security;

drop policy if exists google_ads_connections_own on public.google_ads_connections;
create policy google_ads_connections_own on public.google_ads_connections
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- Done. Verify with:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'google_ads_connections' ORDER BY ordinal_position;
-- ============================================================
