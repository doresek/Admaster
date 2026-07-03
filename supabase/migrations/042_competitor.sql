-- ============================================================
-- 042_competitor — C-09 competitor watch (MARKETING-CAPABILITIES-SPEC C-09):
-- tracked competitor entities per client + their observed ads (Ad Library
-- pulls or manual paste), decoded into angles for the coverage map.
-- ADDITIVE / REVERSIBLE. RLS owner-only. Reverse: 042_competitor.down.sql
-- ============================================================

create table if not exists public.competitor_entities (
  id             uuid primary key default uuid_generate_v4(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  name           text not null,
  page_ref       text,                          -- FB page id/url when known
  ring           text not null default 'direct'
                   check (ring in ('direct','category','non_consumption')),
  active         bool not null default true,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (client_id, name)
);
create index if not exists idx_competitor_entities_client on public.competitor_entities(client_id, active);
create index if not exists idx_competitor_entities_owner  on public.competitor_entities(owner_user_id);
alter table public.competitor_entities enable row level security;
drop policy if exists competitor_entities_own on public.competitor_entities;
create policy competitor_entities_own on public.competitor_entities
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

create table if not exists public.competitor_ads (
  id               uuid primary key default uuid_generate_v4(),
  entity_id        uuid not null references public.competitor_entities(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  owner_user_id    uuid not null references public.users(id) on delete cascade,
  platform_ad_ref  text not null,               -- Ad Library id, or manual:<hash>
  first_seen       date not null,
  last_seen        date not null,
  active           bool not null default true,
  creative         jsonb not null default '{}'::jsonb,  -- {text, format, platforms, landing_url}
  decoded          jsonb,                                -- {angle, awareness, offer, confidence}
  created_at       timestamptz default now(),
  unique (entity_id, platform_ad_ref)
);
create index if not exists idx_competitor_ads_entity on public.competitor_ads(entity_id, active);
create index if not exists idx_competitor_ads_client on public.competitor_ads(client_id);
create index if not exists idx_competitor_ads_owner  on public.competitor_ads(owner_user_id);
alter table public.competitor_ads enable row level security;
drop policy if exists competitor_ads_own on public.competitor_ads;
create policy competitor_ads_own on public.competitor_ads
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
