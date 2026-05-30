-- ============================================================
-- 008: Backfill `recommendations` (from 005_phase_c.sql) and
-- `scores` (from 006_performance_score.sql) — both were never
-- applied to production (migration-numbering drift; see 007).
--
-- recommendations → /api/recommendations (dashboard recs)
-- scores          → /api/ai/score + /api/ai/score/boost (perf score)
--
-- Idempotent — safe to run on prod as-is.
-- ============================================================

-- ── RECOMMENDATIONS ─────────────────────────────────────────
create table if not exists public.recommendations (
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

create index if not exists idx_recs_user
  on public.recommendations(user_id, dismissed, priority desc, created_at desc);

alter table public.recommendations enable row level security;
drop policy if exists "own" on public.recommendations;
create policy "own" on public.recommendations using (auth.uid() = user_id);

-- ── SCORES (predictive performance score) ───────────────────
create table if not exists public.scores (
  id                uuid default uuid_generate_v4() primary key,
  user_id           uuid references public.users(id) on delete cascade not null,
  brand_id          uuid,
  source_kind       text not null check (source_kind in (
    'master_post','variation','refine','manual','saved_ad'
  )),
  source_id         uuid,
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

create index if not exists idx_scores_user_created on public.scores(user_id, created_at desc);
create index if not exists idx_scores_source       on public.scores(source_kind, source_id);
create index if not exists idx_scores_parent       on public.scores(parent_score_id) where parent_score_id is not null;

alter table public.scores enable row level security;
drop policy if exists "own_select" on public.scores;
drop policy if exists "own_insert" on public.scores;
drop policy if exists "own_delete" on public.scores;
create policy "own_select" on public.scores for select using (auth.uid() = user_id);
create policy "own_insert" on public.scores for insert with check (auth.uid() = user_id);
create policy "own_delete" on public.scores for delete using (auth.uid() = user_id);
-- no update policy: scores are immutable; boosts create new rows
