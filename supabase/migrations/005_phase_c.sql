-- ============================================================
-- AdMaster Pro — Schema Update v5 (Phase C)
-- Notifications, user settings, offer stacks, AI analysis logs.
-- Run AFTER 004_phase_b.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- NOTIFICATIONS (in-app bell)
-- ────────────────────────────────────────────────────────────
create table public.notifications (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.users(id) on delete cascade not null,
  type        text not null check (type in (
    'approval_response',   -- client approved / requested changes / rejected
    'lead_submission',     -- landing page form submission
    'series_progress',     -- message series milestone
    'credits_low',         -- credits running out
    'billing',             -- payment success / failure
    'support_reply',       -- support team replied
    'recommendation',      -- new AI recommendation
    'system'
  )),
  title       text not null,
  body        text,
  href        text,                  -- where to go when clicked
  read        boolean default false,
  meta        jsonb default '{}'::jsonb,
  created_at  timestamptz default now()
);

create index idx_notifications_user on public.notifications(user_id, read, created_at desc);

alter table public.notifications enable row level security;
create policy "own"        on public.notifications using (auth.uid() = user_id);
create policy "own_update" on public.notifications for update using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- USER SETTINGS (notification prefs + UI prefs)
-- ────────────────────────────────────────────────────────────
create table public.user_settings (
  user_id            uuid references public.users(id) on delete cascade primary key,
  notif_approval     boolean default true,
  notif_lead         boolean default true,
  notif_series       boolean default true,
  notif_credits_low  boolean default true,
  notif_billing      boolean default true,
  notif_support      boolean default true,
  notif_email        boolean default false,  -- duplicate notifications to email
  theme              text default 'dark' check (theme in ('dark','light')),
  default_platform   text default 'facebook',
  default_tone       text default 'חם ואישי',
  default_framework  text default 'pas',
  updated_at         timestamptz default now()
);

alter table public.user_settings enable row level security;
create policy "own" on public.user_settings using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- OFFER STACKS (Hormozi value stack builder output)
-- ────────────────────────────────────────────────────────────
create table public.offer_stacks (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.users(id) on delete cascade not null,
  client_id       uuid references public.meta_clients(id) on delete set null,
  brief_id        uuid references public.briefs(id) on delete set null,
  product_name    text not null,
  target_outcome  text,
  -- The structured stack output
  main_offer      jsonb default '{}'::jsonb,    -- { name, price, value }
  bonuses         jsonb default '[]'::jsonb,    -- [{ name, value, why_it_matters }]
  total_value     numeric(12,2),
  price_anchor    numeric(12,2),
  final_price     numeric(12,2),
  guarantee       text,
  scarcity        text,
  urgency         text,
  cta             text,
  full_pitch      text,                         -- ready-to-use pitch text
  created_at      timestamptz default now()
);

create index idx_offer_stacks_user on public.offer_stacks(user_id, created_at desc);

alter table public.offer_stacks enable row level security;
create policy "own" on public.offer_stacks using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- BRIEF ANALYSES (history of "analyze_briefing" runs)
-- ────────────────────────────────────────────────────────────
create table public.brief_analyses (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.users(id) on delete cascade not null,
  brief_id    uuid references public.briefs(id) on delete set null,
  -- Outputs
  completeness_score int,
  strengths   jsonb default '[]'::jsonb,   -- ["...","..."]
  gaps        jsonb default '[]'::jsonb,
  questions   jsonb default '[]'::jsonb,   -- suggested questions to ask the client
  refinements jsonb default '[]'::jsonb,   -- concrete edits to suggest
  raw_text    text,
  created_at  timestamptz default now()
);

create index idx_brief_analyses_user on public.brief_analyses(user_id, created_at desc);

alter table public.brief_analyses enable row level security;
create policy "own" on public.brief_analyses using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- WEAK AD ANALYSES (history of "analyze_weak_results" runs)
-- ────────────────────────────────────────────────────────────
create table public.weak_ad_analyses (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references public.users(id) on delete cascade not null,
  ad_text       text not null,
  metrics       jsonb default '{}'::jsonb,   -- { ctr, cpa, spend, roas, ... }
  diagnosis     text,                        -- main verdict
  root_causes   jsonb default '[]'::jsonb,
  improvements  jsonb default '[]'::jsonb,   -- ordered list of concrete fixes
  rewritten_ad  text,                        -- AI rewrite
  created_at    timestamptz default now()
);

create index idx_weak_ads_user on public.weak_ad_analyses(user_id, created_at desc);

alter table public.weak_ad_analyses enable row level security;
create policy "own" on public.weak_ad_analyses using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- AGENT RECOMMENDATIONS
-- ────────────────────────────────────────────────────────────
create table public.recommendations (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.users(id) on delete cascade not null,
  kind        text not null check (kind in ('quick_win','growth','retention','warning','tip')),
  title       text not null,
  body        text,
  action_href text,
  action_label text,
  priority    int default 0,
  dismissed   boolean default false,
  created_at  timestamptz default now()
);

create index idx_recs_user on public.recommendations(user_id, dismissed, priority desc, created_at desc);

alter table public.recommendations enable row level security;
create policy "own" on public.recommendations using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- Add credit actions used by Phase C
-- (no SQL change needed — CREDIT_COSTS is in types/index.ts)
-- ────────────────────────────────────────────────────────────

-- ────────────────────────────────────────────────────────────
-- RPC: unread notification count (used by sidebar bell)
-- ────────────────────────────────────────────────────────────
create or replace function public.unread_notif_count(p_user_id uuid)
returns int language sql stable security definer as $$
  select count(*)::int from public.notifications
  where user_id = p_user_id and read = false;
$$;

grant execute on function public.unread_notif_count(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────
-- Auto-create user_settings row when user is created
-- ────────────────────────────────────────────────────────────
create or replace function public.handle_new_user_settings()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_settings (user_id) values (new.id)
    on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_user_created_settings on public.users;
create trigger on_user_created_settings
  after insert on public.users
  for each row execute function public.handle_new_user_settings();

-- Backfill existing users
insert into public.user_settings (user_id)
  select id from public.users
  on conflict (user_id) do nothing;
