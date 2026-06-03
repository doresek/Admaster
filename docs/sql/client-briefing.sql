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
-- ============================================================
