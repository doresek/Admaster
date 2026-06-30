-- ============================================================
-- 030_ai_marketer — execution + measurement layer for the "AI marketer"
-- ADDITIVE / REVERSIBLE. New tables only. RLS owner-only on every table.
-- FK'd to clients/content_artifacts/client_insights/users. No existing column dropped or altered.
-- Create order respects FKs:
--   campaigns -> campaign_items -> campaign_decisions
--   content_performance (refs content_artifacts) -> diagnoses -> whatsapp_messages
-- Reverse: see 030_ai_marketer.down.sql
-- ============================================================

-- 1) campaigns — a managed marketing campaign for a client (the unit the system "runs")
create table if not exists public.campaigns (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  name            text not null,
  objective       text,                                   -- awareness | traffic | leads | conversions | engagement | messages
  channel         text not null default 'meta_paid' check (channel in ('meta_paid','meta_organic','whatsapp')),
  status          text not null default 'draft'
                    check (status in ('draft','planned','generating','assembled','scheduled','publishing','live','paused','completed','failed')),
  daily_budget    numeric(12,2),                          -- in account currency; null for organic
  funnel_stage    text,                                   -- TOFU | MOFU | BOFU
  meta_campaign_id text,                                  -- Meta Ads campaign id once created
  dry_run         boolean not null default true,          -- true until live publish path is enabled
  grounded_in     uuid[] not null default '{}',           -- client_insights atoms that justified this campaign
  rationale       text,                                   -- plain-language WHY (insight-driven)
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_campaigns_client_status on public.campaigns(client_id, status);
create index if not exists idx_campaigns_owner          on public.campaigns(owner_user_id);
create index if not exists idx_campaigns_grounded       on public.campaigns using gin (grounded_in);
alter table public.campaigns enable row level security;
drop policy if exists campaigns_own on public.campaigns;
create policy campaigns_own on public.campaigns
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 2) campaign_items — an ad / post / message inside a campaign, linked to its source artifact
create table if not exists public.campaign_items (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid not null references public.campaigns(id) on delete cascade,
  client_id       uuid not null references public.clients(id) on delete cascade,
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  artifact_id     uuid references public.content_artifacts(id) on delete set null,
  item_type       text not null check (item_type in ('ad','post','adset','creative','message')),
  status          text not null default 'draft'
                    check (status in ('draft','assembled','scheduled','published','paused','failed','superseded')),
  meta_object_id  text,                                   -- adset/ad/creative/post id on Meta
  targeting_spec  jsonb default '{}'::jsonb,              -- audience spec derived from insights (T3)
  ab_parent_id    uuid references public.campaign_items(id) on delete set null,  -- auto-improve A/B link
  grounded_in     uuid[] not null default '{}',
  rationale       text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_campaign_items_campaign on public.campaign_items(campaign_id, status);
create index if not exists idx_campaign_items_client   on public.campaign_items(client_id);
create index if not exists idx_campaign_items_artifact on public.campaign_items(artifact_id);
alter table public.campaign_items enable row level security;
drop policy if exists campaign_items_own on public.campaign_items;
create policy campaign_items_own on public.campaign_items
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 3) campaign_decisions — the grounded decision log (the moat made auditable)
create table if not exists public.campaign_decisions (
  id              uuid primary key default uuid_generate_v4(),
  campaign_id     uuid references public.campaigns(id) on delete cascade,
  client_id       uuid not null references public.clients(id) on delete cascade,
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  decision_type   text not null,                          -- angle | audience | platform | budget | objective | funnel | channel
  decision        jsonb not null default '{}'::jsonb,     -- the chosen value (e.g. targeting spec, budget split)
  grounded_in     uuid[] not null default '{}',           -- insight atoms behind it
  rationale       text not null,                          -- "chose X because insight Y @conf Z"
  created_at      timestamptz default now()
);
create index if not exists idx_decisions_campaign on public.campaign_decisions(campaign_id);
create index if not exists idx_decisions_client    on public.campaign_decisions(client_id, decision_type);
alter table public.campaign_decisions enable row level security;
drop policy if exists campaign_decisions_own on public.campaign_decisions;
create policy campaign_decisions_own on public.campaign_decisions
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 4) content_performance — per-ad metrics keyed to the artifact (Phase B ingestion target)
create table if not exists public.content_performance (
  id              uuid primary key default uuid_generate_v4(),
  artifact_id     uuid references public.content_artifacts(id) on delete set null,
  campaign_item_id uuid references public.campaign_items(id) on delete set null,
  client_id       uuid not null references public.clients(id) on delete cascade,
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  source          text not null default 'meta' check (source in ('meta','manual')),
  ad_id           text,                                   -- Meta ad-level linkage (required for diagnosis)
  metrics         jsonb not null default '{}'::jsonb,     -- impressions/clicks/ctr/reach/conversions/cpa/roas/spend/thumbstop/hold_rate
  period_start    date,
  period_end      date,
  verdict         text check (verdict in ('worked','underperformed','failed')),
  created_at      timestamptz default now()
);
create index if not exists idx_perf_client      on public.content_performance(client_id);
create index if not exists idx_perf_artifact     on public.content_performance(artifact_id);
create index if not exists idx_perf_ad           on public.content_performance(ad_id);
alter table public.content_performance enable row level security;
drop policy if exists content_performance_own on public.content_performance;
create policy content_performance_own on public.content_performance
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 5) diagnoses — which LINK failed, reasoned from the living insights (the differentiator)
create table if not exists public.diagnoses (
  id                  uuid primary key default uuid_generate_v4(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  owner_user_id       uuid not null references public.users(id) on delete cascade,
  scope_artifact_id   uuid references public.content_artifacts(id) on delete set null,
  scope_campaign_id   uuid references public.campaigns(id) on delete set null,
  failed_link         text not null check (failed_link in ('hook','avatar','creative','funnel','offer','audience','none')),
  rationale           text not null,                      -- insight-driven explanation
  evidence            jsonb default '{}'::jsonb,          -- metrics + cohort comparison
  target_insight_ids  uuid[] not null default '{}',       -- atoms to adjust
  recommended_action  jsonb default '{}'::jsonb,
  applied             boolean not null default false,
  applied_item_id     uuid references public.campaign_items(id) on delete set null,
  created_at          timestamptz default now()
);
create index if not exists idx_diagnoses_client   on public.diagnoses(client_id);
create index if not exists idx_diagnoses_artifact  on public.diagnoses(scope_artifact_id);
create index if not exists idx_diagnoses_targets   on public.diagnoses using gin (target_insight_ids);
alter table public.diagnoses enable row level security;
drop policy if exists diagnoses_own on public.diagnoses;
create policy diagnoses_own on public.diagnoses
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 6) whatsapp_messages — InforU-backed sends (Geula Mode infra), insight-grounded
create table if not exists public.whatsapp_messages (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  campaign_id     uuid references public.campaigns(id) on delete set null,
  artifact_id     uuid references public.content_artifacts(id) on delete set null,
  to_phone        text not null,
  body            text not null,
  template_name   text,
  provider        text not null default 'inforu',
  provider_msg_id text,
  status          text not null default 'queued'
                    check (status in ('queued','sent','delivered','read','failed')),
  grounded_in     uuid[] not null default '{}',
  error           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_wa_client_status on public.whatsapp_messages(client_id, status);
create index if not exists idx_wa_campaign       on public.whatsapp_messages(campaign_id);
alter table public.whatsapp_messages enable row level security;
drop policy if exists whatsapp_messages_own on public.whatsapp_messages;
create policy whatsapp_messages_own on public.whatsapp_messages
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
