-- ════════════════════════════════════════════════════════════
-- 014_brief_client_link
-- Link briefs and brief_codes to a meta_clients row so a brief can
-- resolve to a client directly instead of by biz_name substring match.
-- Also relax meta_clients.token (clients can exist before a Meta token).
-- DDL only — apply manually in the Supabase SQL Editor.
-- ════════════════════════════════════════════════════════════

alter table public.meta_clients
  alter column token drop not null;

alter table public.brief_codes
  add column if not exists client_id uuid references public.meta_clients(id) on delete cascade;

alter table public.briefs
  add column if not exists client_id uuid references public.meta_clients(id) on delete set null;

create index if not exists idx_briefs_client_id on public.briefs(client_id);
create index if not exists idx_brief_codes_client_id on public.brief_codes(client_id);
