-- ============================================================
-- AdMaster Pro — Security Hardening
-- Run AFTER 001_schema.sql and 002_features.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Prevent users from updating credits/plan directly
--    Revoke generic UPDATE, grant only on safe columns.
--    deduct_credits() is SECURITY DEFINER so it bypasses this.
-- ────────────────────────────────────────────────────────────
revoke update on public.users from authenticated;
grant  update (name, brand, updated_at) on public.users to authenticated;

-- ────────────────────────────────────────────────────────────
-- 2. Add `with check` to policies missing it (insert/update safety)
-- ────────────────────────────────────────────────────────────
drop policy if exists "users_own"            on public.users;
drop policy if exists "credits_own"          on public.credit_history;
drop policy if exists "brief_codes_own"      on public.brief_codes;
drop policy if exists "meta_clients_own"     on public.meta_clients;
drop policy if exists "content_own"          on public.generated_content;

create policy "users_select_own"        on public.users
  for select using (auth.uid() = id);
create policy "users_update_own"        on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "credits_select_own"      on public.credit_history
  for select using (auth.uid() = user_id);
-- inserts to credit_history are done by SECURITY DEFINER func only

create policy "brief_codes_all_own"     on public.brief_codes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "meta_clients_all_own"    on public.meta_clients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "content_all_own"         on public.generated_content
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Tighten 002 features (each had `for all using (...)` without with check)
drop policy if exists "own"     on public.scheduled_posts;
drop policy if exists "own"     on public.pixels;
drop policy if exists "own"     on public.generated_images;
drop policy if exists "own"     on public.reports;
drop policy if exists "own_ag"  on public.agency_settings;
drop policy if exists "own_ap"  on public.ad_performance;

create policy "scheduled_all_own"   on public.scheduled_posts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "pixels_all_own"      on public.pixels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "images_all_own"      on public.generated_images
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "reports_all_own"     on public.reports
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "agency_all_own"      on public.agency_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "perf_all_own"        on public.ad_performance
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- 3. Stripe webhook idempotency table
-- ────────────────────────────────────────────────────────────
create table if not exists public.stripe_events (
  id          text primary key,            -- Stripe event id (evt_...)
  type        text not null,
  received_at timestamptz default now()
);
alter table public.stripe_events enable row level security;
-- No policies → only service_role can read/write.

-- ────────────────────────────────────────────────────────────
-- 4. Encrypted Meta tokens
--    Add new `token_encrypted` column, drop NOT NULL on `token`.
--    Application layer encrypts via lib/crypto.ts before insert.
--    New code writes only to token_encrypted; `token` kept for
--    legacy reads until a later migration drops it.
-- ────────────────────────────────────────────────────────────
alter table public.meta_clients
  add column if not exists token_encrypted text;
alter table public.meta_clients
  alter column token drop not null;
