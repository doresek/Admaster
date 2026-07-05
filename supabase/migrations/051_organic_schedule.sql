-- 051_organic_schedule.sql — P1-1 (ORGANIC-TASKS): scheduling v2 for organic posts.
--
-- DESIGN DECISION (spec §1.3.3 left it open): a NEW table, not a retrofit of
-- legacy `scheduled_posts`. Reasons: scheduled_posts FKs the legacy `meta_clients`
-- id space and conflates photo/link semantics; the old /schedule page keeps
-- working against it untouched, zero migration risk. This table is the organic
-- pipeline's slot store: one row = one planned/scheduled/published page post,
-- linked into the ONE decision trace (campaigns/campaign_items) and grounded.
--
-- ADDITIVE ONLY. RLS owner-only, same convention as migration 030.

create table if not exists public.organic_schedule (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  owner_user_id     uuid not null references public.users(id) on delete cascade,
  campaign_id       uuid references public.campaigns(id) on delete set null,
  campaign_item_id  uuid references public.campaign_items(id) on delete set null,
  page_id           text,                                   -- FB page the slot publishes to (null until publish wiring)
  post_kind         text not null default 'text'
                      check (post_kind in ('text','photo','link')),  -- fixes the legacy image-as-link conflation
  message           text,                                   -- final composed post text (null while slot is plan-only)
  image_url         text,                                   -- photo posts: public image URL (Graph fetches it)
  link_url          text,                                   -- link posts
  scheduled_at      timestamptz not null,                   -- when the post should go live (Meta-native scheduling holds the queue)
  published_at      timestamptz,
  meta_post_id      text,                                   -- Graph post id once published (dryrun_* in dry-run)
  status            text not null default 'planned'
                      check (status in ('planned','scheduled','publishing','published','failed','cancelled')),
  grounded_in       uuid[] not null default '{}',           -- client_insights atoms behind this slot's topic/angle
  rationale         text,                                   -- plain-language WHY (Hebrew)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_organic_schedule_client_status on public.organic_schedule(client_id, status);
create index if not exists idx_organic_schedule_due           on public.organic_schedule(status, scheduled_at);
create index if not exists idx_organic_schedule_owner         on public.organic_schedule(owner_user_id);
create index if not exists idx_organic_schedule_item          on public.organic_schedule(campaign_item_id);

alter table public.organic_schedule enable row level security;

drop policy if exists organic_schedule_owner_all on public.organic_schedule;
create policy organic_schedule_owner_all on public.organic_schedule
  for all
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
