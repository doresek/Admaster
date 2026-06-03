-- Meta Ads Launcher (Phase 1): record every ad launched from inside AdMaster,
-- linking the Meta object IDs (campaign/adset/creative/ad) back to our DB.
-- Phase 2 reads this table to fetch per-ad insights and generate AI recommendations.

create table if not exists public.launched_ads (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.users(id) on delete cascade,
  client_id       uuid references public.meta_clients(id) on delete set null,
  approval_id     uuid references public.approvals(id) on delete set null,
  ad_account_id   text not null,
  campaign_id     text,
  adset_id        text,
  creative_id     text,
  ad_id           text,
  destination     jsonb,          -- {type, value, slug?}
  targeting       jsonb,          -- the resolved Meta targeting spec we sent
  budget          int,            -- daily budget, account-currency minor units
  objective       text,
  headline        text,
  primary_text    text,
  cta             text,
  image_url       text,
  status          text default 'PAUSED',  -- PAUSED | ACTIVE | failed
  created_at      timestamptz default now()
);

create index if not exists idx_launched_ads_user   on public.launched_ads(user_id);
create index if not exists idx_launched_ads_client on public.launched_ads(client_id);

alter table public.launched_ads enable row level security;

drop policy if exists "launched_ads_own" on public.launched_ads;
create policy "launched_ads_own" on public.launched_ads
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
