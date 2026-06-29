-- ============================================================
-- 025_reporting
-- Client-facing ROI report share-link support.
--
-- A marketer generates a ROI report for a client over a date range, then
-- mints a long, unguessable TOKEN so the client can open a public, stable
-- link (/report/<token>) without logging in. The generated report is
-- snapshotted into `report` so the public link is immutable even if the
-- underlying ad_performance data later changes.
--
-- Access control mirrors the brief magic-link / approval portal model:
--   * The token is the ONLY access control on the public report view, so it
--     is a 256-bit CSPRNG value rendered as 64 lowercase hex chars, minted by
--     the app (like brief_codes.token and meta connect tokens).
--   * The public read path uses the SERVICE ROLE + token (exactly like the
--     brief resolver); there is NO public/anon RLS policy. Owners get an
--     authenticated owner policy only.
--
-- ad-level (ad_id) granularity deferred; reporting stays at ad_account+date
-- level per ad_performance (mig 002). Revisit if per-ad breakdown is required.
--
-- Additive + idempotent. DDL only -- apply MANUALLY in the Supabase SQL Editor.
-- ============================================================

-- 1) Share-link table: one row per minted public report link.
create table if not exists public.report_shares (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid not null references public.users(id) on delete cascade,
  client_id     uuid not null references public.meta_clients(id) on delete cascade,
  token         text not null unique,
  period_start  date not null,
  period_end    date not null,
  report        jsonb,
  expires_at    timestamptz,
  created_at    timestamptz default now()
);

-- 2) Indexes: fast public lookup by token, and owner listing by client.
create unique index if not exists idx_report_shares_token
  on public.report_shares(token)
  where token is not null;

create index if not exists idx_report_shares_client
  on public.report_shares(client_id);

-- 3) RLS: owner-only authenticated access. The public read path uses the
--    service role + token and bypasses RLS, so no anon policy is defined.
alter table public.report_shares enable row level security;

drop policy if exists report_shares_own on public.report_shares;
create policy report_shares_own on public.report_shares
  using (auth.uid() = user_id);

-- Verify with:
--   select left(token, 8) || '...' as token_preview, client_id,
--          period_start, period_end, (report is not null) as has_snapshot
--   from public.report_shares order by created_at desc limit 10;
