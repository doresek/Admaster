-- ============================================================
-- AdMaster Pro — Supabase Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ────────────────────────────────────────────────────────────
-- USERS (extends Supabase auth.users)
-- ────────────────────────────────────────────────────────────
create table public.users (
  id          uuid references auth.users(id) on delete cascade primary key,
  name        text not null,
  email       text not null unique,
  credits     int  not null default 150,
  plan        text not null default 'free' check (plan in ('free','starter','pro','agency')),
  brand       jsonb default '{}'::jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- CREDIT HISTORY
-- ────────────────────────────────────────────────────────────
create table public.credit_history (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references public.users(id) on delete cascade not null,
  action     text not null,
  cost       int  not null,
  meta       jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- BRIEF CODES (marketer creates, sends to client)
-- ────────────────────────────────────────────────────────────
create table public.brief_codes (
  id           uuid default uuid_generate_v4() primary key,
  code         text not null unique,
  user_id      uuid references public.users(id) on delete cascade not null,
  agency_name  text,
  created_at   timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- BRIEFS (client submissions)
-- ────────────────────────────────────────────────────────────
create table public.briefs (
  id           uuid default uuid_generate_v4() primary key,
  code         text not null references public.brief_codes(code),
  user_id      uuid references public.users(id) on delete cascade not null,
  values       jsonb not null default '{}'::jsonb,
  avatar       text,
  ads          text,
  funnel       text,
  status       text not null default 'new' check (status in ('new','has_avatar','complete')),
  submitted_at timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- META CLIENTS
-- ────────────────────────────────────────────────────────────
create table public.meta_clients (
  id                     uuid default uuid_generate_v4() primary key,
  user_id                uuid references public.users(id) on delete cascade not null,
  name                   text not null,
  industry               text,
  emoji                  text default '🏢',
  -- Token stored encrypted — use Supabase Vault in production
  token                  text not null,
  meta_user_id           text,
  meta_user_name         text,
  pages                  jsonb default '[]'::jsonb,
  ad_accounts            jsonb default '[]'::jsonb,
  selected_page_id       text,
  selected_ad_account_id text,
  status                 text default 'connected',
  posts_published        int  default 0,
  campaigns_created      int  default 0,
  connected_at           timestamptz default now(),
  updated_at             timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- GENERATED CONTENT (posts, analyses, etc.)
-- ────────────────────────────────────────────────────────────
create table public.generated_content (
  id         uuid default uuid_generate_v4() primary key,
  user_id    uuid references public.users(id) on delete cascade not null,
  type       text not null, -- 'post','analysis','variation','holiday','brief_ad'
  platform   text,
  input      jsonb default '{}'::jsonb,
  output     jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- PLANS (reference)
-- ────────────────────────────────────────────────────────────
create table public.plans (
  id      text primary key,
  name    text not null,
  credits int  not null,
  price   int  not null -- in ILS
);

insert into public.plans values
  ('free',    'חינמי',   150,   0),
  ('starter', 'Starter', 400,   79),
  ('pro',     'Pro',     1200,  199),
  ('agency',  'Agency',  5000,  499);

-- ────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────
create index idx_credit_history_user on public.credit_history(user_id);
create index idx_briefs_code        on public.briefs(code);
create index idx_briefs_user        on public.briefs(user_id);
create index idx_meta_clients_user  on public.meta_clients(user_id);
create index idx_content_user       on public.generated_content(user_id);
create index idx_brief_codes_user   on public.brief_codes(user_id);

-- ────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY (RLS)
-- ────────────────────────────────────────────────────────────
alter table public.users             enable row level security;
alter table public.credit_history    enable row level security;
alter table public.brief_codes       enable row level security;
alter table public.briefs            enable row level security;
alter table public.meta_clients      enable row level security;
alter table public.generated_content enable row level security;

-- Users: own rows only
create policy "users_own" on public.users
  using (auth.uid() = id);

-- Credit history: own rows only
create policy "credits_own" on public.credit_history
  using (auth.uid() = user_id);

-- Brief codes: own rows only
create policy "brief_codes_own" on public.brief_codes
  using (auth.uid() = user_id);

-- Briefs: marketer sees own, client can insert by code
create policy "briefs_marketer_select" on public.briefs
  for select using (auth.uid() = user_id);

create policy "briefs_client_insert" on public.briefs
  for insert with check (
    code in (select code from public.brief_codes)
  );

create policy "briefs_marketer_update" on public.briefs
  for update using (auth.uid() = user_id);

-- Meta clients: own rows only
create policy "meta_clients_own" on public.meta_clients
  using (auth.uid() = user_id);

-- Generated content: own rows only
create policy "content_own" on public.generated_content
  using (auth.uid() = user_id);

-- Plans: read-only for all
create policy "plans_read" on public.plans
  for select using (true);

-- ────────────────────────────────────────────────────────────
-- FUNCTIONS
-- ────────────────────────────────────────────────────────────

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (id, name, email, credits, plan)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.email,
    150,
    'free'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Deduct credits (atomic)
create or replace function public.deduct_credits(
  p_user_id uuid,
  p_action  text,
  p_cost    int
)
returns json language plpgsql security definer as $$
declare
  v_credits int;
begin
  select credits into v_credits from public.users where id = p_user_id for update;

  if v_credits < p_cost then
    return json_build_object('success', false, 'error', 'insufficient_credits', 'credits', v_credits);
  end if;

  update public.users set credits = credits - p_cost, updated_at = now() where id = p_user_id;

  insert into public.credit_history (user_id, action, cost)
  values (p_user_id, p_action, p_cost);

  return json_build_object('success', true, 'credits', v_credits - p_cost);
end;
$$;

-- Update brief status automatically
create or replace function public.update_brief_status()
returns trigger language plpgsql as $$
begin
  if new.funnel is not null then
    new.status = 'complete';
  elsif new.avatar is not null then
    new.status = 'has_avatar';
  else
    new.status = 'new';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create trigger brief_status_trigger
  before update on public.briefs
  for each row execute function public.update_brief_status();
