-- ============================================================
-- AdMaster Pro — Schema Update v2
-- Run AFTER 001_schema.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- SCHEDULED POSTS (content calendar)
-- ────────────────────────────────────────────────────────────
create table public.scheduled_posts (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references public.users(id) on delete cascade not null,
  client_id        uuid references public.meta_clients(id) on delete cascade,
  page_id          text not null,
  message          text not null,
  image_url        text,
  scheduled_at     timestamptz not null,
  published_at     timestamptz,
  meta_post_id     text,
  status           text default 'scheduled' check (status in ('scheduled','published','failed','cancelled')),
  platform         text default 'facebook',
  created_at       timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- PIXELS
-- ────────────────────────────────────────────────────────────
create table public.pixels (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references public.users(id) on delete cascade not null,
  client_id        uuid references public.meta_clients(id) on delete cascade,
  name             text not null,
  meta_pixel_id    text,
  pixel_code       text,
  website_url      text,
  events_tracked   jsonb default '[]'::jsonb,
  status           text default 'active',
  created_at       timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- GENERATED IMAGES
-- ────────────────────────────────────────────────────────────
create table public.generated_images (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references public.users(id) on delete cascade not null,
  prompt           text not null,
  image_url        text not null,
  provider         text default 'ideogram',
  style            text,
  aspect_ratio     text default '1:1',
  used_in          text,
  created_at       timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- REPORTS
-- ────────────────────────────────────────────────────────────
create table public.reports (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references public.users(id) on delete cascade not null,
  client_id        uuid references public.meta_clients(id) on delete cascade,
  title            text not null,
  period_start     date not null,
  period_end       date not null,
  data             jsonb default '{}'::jsonb,
  pdf_url          text,
  sent_to          text,
  sent_at          timestamptz,
  created_at       timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- TEAM MEMBERS
-- ────────────────────────────────────────────────────────────
create table public.team_members (
  id               uuid default uuid_generate_v4() primary key,
  owner_id         uuid references public.users(id) on delete cascade not null,
  member_id        uuid references public.users(id) on delete cascade,
  email            text not null,
  name             text,
  role             text default 'agent' check (role in ('admin','agent','viewer')),
  status           text default 'pending' check (status in ('pending','active','inactive')),
  invited_at       timestamptz default now(),
  joined_at        timestamptz,
  unique(owner_id, email)
);

-- ────────────────────────────────────────────────────────────
-- AGENCY SETTINGS (white-label)
-- ────────────────────────────────────────────────────────────
create table public.agency_settings (
  user_id          uuid references public.users(id) on delete cascade primary key,
  agency_name      text,
  logo_url         text,
  primary_color    text default '#0A7AFF',
  secondary_color  text default '#D4AF55',
  custom_domain    text,
  support_email    text,
  whatsapp_number  text,
  footer_text      text,
  updated_at       timestamptz default now()
);

-- ────────────────────────────────────────────────────────────
-- AD PERFORMANCE CACHE (Meta Insights)
-- ────────────────────────────────────────────────────────────
create table public.ad_performance (
  id               uuid default uuid_generate_v4() primary key,
  user_id          uuid references public.users(id) on delete cascade not null,
  client_id        uuid references public.meta_clients(id) on delete cascade not null,
  ad_account_id    text not null,
  date             date not null,
  impressions      bigint default 0,
  clicks           bigint default 0,
  spend            numeric(10,2) default 0,
  reach            bigint default 0,
  frequency        numeric(6,3) default 0,
  ctr              numeric(6,4) default 0,
  cpc              numeric(8,2) default 0,
  cpm              numeric(8,2) default 0,
  conversions      int default 0,
  cost_per_result  numeric(8,2) default 0,
  roas             numeric(6,3) default 0,
  fetched_at       timestamptz default now(),
  unique(client_id, ad_account_id, date)
);

-- ────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────
create index idx_scheduled_user      on public.scheduled_posts(user_id);
create index idx_scheduled_status    on public.scheduled_posts(status, scheduled_at);
create index idx_pixels_user         on public.pixels(user_id);
create index idx_images_user         on public.generated_images(user_id);
create index idx_reports_user        on public.reports(user_id);
create index idx_team_owner          on public.team_members(owner_id);
create index idx_perf_client_date    on public.ad_performance(client_id, date);

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────
alter table public.scheduled_posts   enable row level security;
alter table public.pixels            enable row level security;
alter table public.generated_images  enable row level security;
alter table public.reports           enable row level security;
alter table public.team_members      enable row level security;
alter table public.agency_settings   enable row level security;
alter table public.ad_performance    enable row level security;

create policy "own" on public.scheduled_posts  using (auth.uid()=user_id);
create policy "own" on public.pixels           using (auth.uid()=user_id);
create policy "own" on public.generated_images using (auth.uid()=user_id);
create policy "own" on public.reports          using (auth.uid()=user_id);
create policy "own_tm" on public.team_members  using (auth.uid()=owner_id or auth.uid()=member_id);
create policy "own_ag" on public.agency_settings using (auth.uid()=user_id);
create policy "own_ap" on public.ad_performance  using (auth.uid()=user_id);

-- ────────────────────────────────────────────────────────────
-- Update users table — add team/agency fields
-- ────────────────────────────────────────────────────────────
alter table public.users
  add column if not exists plan_expires_at timestamptz,
  add column if not exists is_agency       boolean default false,
  add column if not exists owner_id        uuid references public.users(id);
