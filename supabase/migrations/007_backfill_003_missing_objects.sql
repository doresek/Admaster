-- ============================================================
-- 007: Backfill the parts of 003_messages_and_series.sql that were
-- never applied to production.
--
-- Context: prod's migration history applied a *different* 003
-- ("lock_credits") and only cherry-picked `messages` + the
-- generated_images edit-chain alter from 003_messages_and_series.sql.
-- These objects were left missing, causing 404s on /series, /refine,
-- /approvals, the public approval portal, and the /contact form:
--   message_series, series_messages, refinements, approvals (+RPCs), contacts
--
-- This migration is fully idempotent — safe to run on prod as-is.
-- It does NOT touch `messages` or generated_images (already present).
-- ============================================================

-- ── MESSAGE SERIES ──────────────────────────────────────────
create table if not exists public.message_series (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references public.users(id) on delete cascade not null,
  client_id     uuid references public.meta_clients(id) on delete set null,
  name          text not null,
  goal          text,
  duration_days int  not null check (duration_days > 0 and duration_days <= 365),
  channels      jsonb default '[]'::jsonb,
  status        text default 'draft' check (status in ('draft','active','paused','done')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists public.series_messages (
  id            uuid default uuid_generate_v4() primary key,
  series_id     uuid references public.message_series(id) on delete cascade not null,
  day_offset    int  not null check (day_offset >= 0 and day_offset <= 365),
  channel       text not null check (channel in ('email','sms','whatsapp')),
  framework     text,
  subject       text,
  body          text not null,
  position      int  default 0,
  created_at    timestamptz default now()
);

create index if not exists idx_series_user        on public.message_series(user_id);
create index if not exists idx_series_messages_id on public.series_messages(series_id, day_offset);

alter table public.message_series  enable row level security;
alter table public.series_messages enable row level security;

drop policy if exists "own"        on public.message_series;
drop policy if exists "via_series" on public.series_messages;
create policy "own" on public.message_series using (auth.uid() = user_id);
create policy "via_series" on public.series_messages
  using (series_id in (select id from public.message_series where user_id = auth.uid()));

-- ── REFINEMENTS ─────────────────────────────────────────────
create table if not exists public.refinements (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references public.users(id) on delete cascade not null,
  parent_id     uuid references public.refinements(id) on delete set null,
  original_text text not null,
  refined_text  text not null,
  feedback      text not null,
  iteration     int default 1,
  created_at    timestamptz default now()
);

create index if not exists idx_refinements_user   on public.refinements(user_id);
create index if not exists idx_refinements_parent on public.refinements(parent_id);

alter table public.refinements enable row level security;
drop policy if exists "own" on public.refinements;
create policy "own" on public.refinements using (auth.uid() = user_id);

-- ── APPROVALS ───────────────────────────────────────────────
create table if not exists public.approvals (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references public.users(id) on delete cascade not null,
  client_id     uuid references public.meta_clients(id) on delete set null,
  token         text not null unique,
  title         text,
  content       jsonb not null default '{}'::jsonb,
  status        text default 'pending' check (status in ('pending','approved','changes','rejected')),
  feedback      text,
  created_at    timestamptz default now(),
  responded_at  timestamptz
);

create index if not exists idx_approvals_user  on public.approvals(user_id);
create index if not exists idx_approvals_token on public.approvals(token);

alter table public.approvals enable row level security;
drop policy if exists "own" on public.approvals;
create policy "own" on public.approvals using (auth.uid() = user_id);

create or replace function public.get_approval_by_token(p_token text)
returns table (
  id          uuid,
  title       text,
  content     jsonb,
  status      text,
  feedback    text,
  created_at  timestamptz,
  responded_at timestamptz,
  agency_name text,
  primary_color text,
  secondary_color text
)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  select a.id, a.title, a.content, a.status, a.feedback, a.created_at, a.responded_at,
         coalesce(s.agency_name, u.name)        as agency_name,
         coalesce(s.primary_color, '#0A7AFF')   as primary_color,
         coalesce(s.secondary_color, '#D4AF55') as secondary_color
  from public.approvals a
  join public.users u on u.id = a.user_id
  left join public.agency_settings s on s.user_id = a.user_id
  where a.token = p_token;
end;
$$;

create or replace function public.respond_to_approval(
  p_token    text,
  p_status   text,
  p_feedback text
)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if p_status not in ('approved','changes','rejected') then
    return json_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.approvals
    set status = p_status,
        feedback = p_feedback,
        responded_at = now()
    where token = p_token and status = 'pending'
    returning id into v_id;

  if v_id is null then
    return json_build_object('success', false, 'error', 'not_found_or_already_responded');
  end if;

  return json_build_object('success', true, 'id', v_id);
end;
$$;

grant execute on function public.get_approval_by_token(text) to anon, authenticated;
grant execute on function public.respond_to_approval(text, text, text) to anon, authenticated;

-- ── CONTACTS ────────────────────────────────────────────────
create table if not exists public.contacts (
  id         uuid default uuid_generate_v4() primary key,
  name       text not null,
  email      text not null,
  subject    text,
  message    text not null,
  status     text default 'new' check (status in ('new','read','replied','spam')),
  created_at timestamptz default now()
);

create index if not exists idx_contacts_status on public.contacts(status, created_at desc);

alter table public.contacts enable row level security;
drop policy if exists "contacts_anon_insert"          on public.contacts;
drop policy if exists "contacts_authenticated_select" on public.contacts;
-- Public contact form needs INSERT only. No SELECT policy is granted:
-- with RLS enabled and no SELECT policy, the contacts inbox is readable
-- ONLY by service_role (backend), never by ordinary authenticated users.
-- This prevents any logged-in customer from reading everyone's submissions.
create policy "contacts_anon_insert" on public.contacts
  for insert to anon, authenticated with check (true);
