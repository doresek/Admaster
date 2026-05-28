-- ============================================================
-- AdMaster Pro — Schema Update v6 (Performance Score)
-- Predictive performance score for every generated variant.
-- Run AFTER 005_phase_c.sql
-- ============================================================

create table public.scores (
  id                uuid default uuid_generate_v4() primary key,
  user_id           uuid references public.users(id) on delete cascade not null,
  brand_id          uuid,  -- soft ref; admaster keeps brand on users.brand jsonb today
  source_kind       text not null check (source_kind in (
    'master_post','variation','refine','manual','saved_ad'
  )),
  source_id         uuid,                            -- soft ref to the originating row
  copy_text         text not null,
  channel           text not null check (channel in (
    'meta_feed','meta_story','meta_reel',
    'google_search','google_display',
    'email','sms','landing','tiktok'
  )),
  audience_segment  jsonb default '{}'::jsonb,
  locale            text not null default 'he' check (locale in ('he','en','ar')),
  score             int not null check (score between 0 and 100),
  band              text not null check (band in ('low','mid','high')),
  demographics      jsonb not null,
  emotions          text[] not null default '{}',
  extracts          jsonb not null default '{}'::jsonb,
  policy_flags      jsonb default '[]'::jsonb,
  predicted_hook    text,
  model_version     text not null default 'claude-haiku-4-5-v1',
  prompt_tokens     int,
  output_tokens     int,
  boost_iteration   int default 0,
  parent_score_id   uuid references public.scores(id) on delete set null,
  created_at        timestamptz default now()
);

create index idx_scores_user_created  on public.scores(user_id, created_at desc);
create index idx_scores_source        on public.scores(source_kind, source_id);
create index idx_scores_parent        on public.scores(parent_score_id) where parent_score_id is not null;

alter table public.scores enable row level security;
create policy "own_select" on public.scores for select using (auth.uid() = user_id);
create policy "own_insert" on public.scores for insert with check (auth.uid() = user_id);
create policy "own_delete" on public.scores for delete using (auth.uid() = user_id);
-- no update policy: scores are immutable; boosts create new rows
