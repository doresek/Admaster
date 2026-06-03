-- ============================================================
-- Client Briefing system — schema additions (FEATURE session, 2026-06-03)
-- Hand-off for the DB session / user to run in the Supabase SQL Editor.
-- (Feature session has NO DDL access; DB session owns migration numbering —
--  fold this into a properly-numbered migration when convenient.)
--
-- Additive only. Idempotent. Does NOT touch client_journeys / onboarding.
-- ============================================================

-- 1) Link a brief to a specific client.
alter table public.briefs
  add column if not exists client_id uuid references public.meta_clients(id) on delete set null;
create index if not exists idx_briefs_client on public.briefs(client_id);

-- 2) Per-client public fill link: a 7-day token on brief_codes.
alter table public.brief_codes
  add column if not exists client_id  uuid references public.meta_clients(id) on delete cascade;
alter table public.brief_codes
  add column if not exists token      text unique;
alter table public.brief_codes
  add column if not exists expires_at timestamptz;
create index if not exists idx_brief_codes_token on public.brief_codes(token);

-- Public fill (no auth) reads brief_codes by token via the service role in
-- /api/briefs/submit, so no new RLS policy is required (service role bypasses RLS).

-- 3) CRM-style clients (auto-ads parity): a client can exist WITHOUT a Meta
--    connection, and carries contact details. meta_clients was Meta-only
--    (token NOT NULL, no contacts), so relax + extend.
alter table public.meta_clients alter column token drop not null;
alter table public.meta_clients add column if not exists email   text;
alter table public.meta_clients add column if not exists phone   text;
alter table public.meta_clients add column if not exists company text;
alter table public.meta_clients add column if not exists notes   text;

-- 4) Unique-per-client constraints so the app's brief / brief_codes upserts are
--    race-safe (autosave fires concurrently). Dedupe any existing rows first
--    (keep the most-recent), then add the constraints. NULL client_id rows
--    (legacy code-only briefs) are unaffected (NULLs are distinct in unique).
delete from public.briefs a using public.briefs b
  where a.client_id is not null and a.client_id = b.client_id
    and (a.updated_at, a.id) < (b.updated_at, b.id);
alter table public.briefs drop constraint if exists briefs_client_uniq;
alter table public.briefs add constraint briefs_client_uniq unique (client_id);

delete from public.brief_codes a using public.brief_codes b
  where a.client_id is not null and a.client_id = b.client_id
    and (a.created_at, a.id) < (b.created_at, b.id);
alter table public.brief_codes drop constraint if exists brief_codes_client_uniq;
alter table public.brief_codes add constraint brief_codes_client_uniq unique (client_id);
-- ============================================================
