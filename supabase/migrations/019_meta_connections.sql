-- ============================================================
-- 019_meta_connections
-- Split the Meta credential + asset snapshot out of meta_clients into a
-- child table, so one client (business) can own 0..n Meta connections and
-- a client can exist with no connection at all.
--
-- Additive + idempotent. Does NOT drop or alter any existing meta_clients
-- column (token/token_encrypted/pages/... stay as legacy-read; see design
-- doc client-connection-model.md section 6). Existing admin/user login and
-- the meta_clients_own RLS policy are untouched.
--
-- DDL only -- apply MANUALLY in the Supabase SQL Editor (H1).
-- Rollback: 019_meta_connections.down.sql
-- Run AFTER 018_brief_code_token.sql. Apply BEFORE 020 and 021.
-- ============================================================

create table if not exists public.meta_connections (
  id                      uuid default uuid_generate_v4() primary key,

  -- The business this connection belongs to.
  client_id               uuid not null
                            references public.meta_clients(id) on delete cascade,

  -- The agency operator who MANAGES this connection (for RLS + listing).
  -- The Meta TOKEN itself may belong to the external client; agency_user_id is
  -- about who can see/manage the row inside AdMaster, not who owns the FB asset.
  agency_user_id          uuid not null
                            references public.users(id) on delete cascade,

  -- Credential. Encrypted with lib/crypto (AES-256-GCM), same format as
  -- meta_clients.token_encrypted. Nullable so a connection row can be created
  -- (e.g. a pending connect link) before the token arrives.
  token_encrypted         text,

  -- Identity of the connected Meta account (whoever authorized).
  meta_user_id            text,
  meta_user_name          text,

  -- Asset snapshot fetched at connect time (same shape as meta_clients today).
  pages                   jsonb default '[]'::jsonb,
  ad_accounts             jsonb default '[]'::jsonb,
  selected_page_id        text,
  selected_ad_account_id  text,

  status                  text default 'connected'
                            check (status in ('pending','connected','error','revoked')),

  connected_at            timestamptz default now(),
  updated_at              timestamptz default now()
);

create index if not exists idx_meta_connections_client
  on public.meta_connections(client_id);
create index if not exists idx_meta_connections_agency
  on public.meta_connections(agency_user_id);

-- One "primary/active" connection per client is the common case. We do NOT
-- enforce uniqueness on client_id (a client may have multiple connections),
-- but the read path picks the most-recent connected row per client.

-- -- RLS ---------------------------------------------------------
alter table public.meta_connections enable row level security;

-- Agency operator sees + manages only their own connection rows. Mirrors the
-- "meta_clients_own" policy in 001_schema.sql. Guarded so re-running is a no-op.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'meta_connections'
      and policyname = 'meta_connections_own'
  ) then
    create policy "meta_connections_own" on public.meta_connections
      using (auth.uid() = agency_user_id)
      with check (auth.uid() = agency_user_id);
  end if;
end $$;

-- NOTE: the session-less connect callback writes the token via the SERVICE ROLE
-- (createAdminClient), which bypasses RLS -- exactly as the public brief resolver
-- does today. The token in the signed link IS the authorization for that write;
-- RLS above governs the authenticated dashboard.

-- ============================================================
-- BACKFILL: move every currently-connected meta_clients row into ONE
-- meta_connections row, so nothing breaks on cutover. Idempotent: re-running
-- will NOT create duplicates (guarded by the NOT EXISTS sub-select).
-- ============================================================

insert into public.meta_connections (
  client_id,
  agency_user_id,
  token_encrypted,
  meta_user_id,
  meta_user_name,
  pages,
  ad_accounts,
  selected_page_id,
  selected_ad_account_id,
  status,
  connected_at,
  updated_at
)
select
  mc.id                                  as client_id,
  mc.user_id                             as agency_user_id,
  -- Preserve whichever credential form the legacy row holds. Legacy plaintext
  -- token rows are tolerated downstream by lib/crypto decryptOrPlaintext, and
  -- are separately re-encrypted by scripts/backfill-encrypt-meta-tokens.ts.
  coalesce(mc.token_encrypted, mc.token) as token_encrypted,
  mc.meta_user_id,
  mc.meta_user_name,
  coalesce(mc.pages, '[]'::jsonb),
  coalesce(mc.ad_accounts, '[]'::jsonb),
  mc.selected_page_id,
  mc.selected_ad_account_id,
  -- Only rows that actually have a credential become 'connected'.
  case
    when coalesce(mc.token_encrypted, mc.token) is not null then 'connected'
    else 'pending'
  end,
  coalesce(mc.connected_at, now()),
  now()
from public.meta_clients mc
where coalesce(mc.token_encrypted, mc.token) is not null   -- only connected clients
  and not exists (
    select 1 from public.meta_connections c
    where c.client_id = mc.id
  );

-- Verify after apply:
--   select c.client_id, mc.name, c.status, left(coalesce(c.token_encrypted,''),8)
--   from public.meta_connections c join public.meta_clients mc on mc.id = c.client_id
--   order by c.connected_at desc limit 20;
