-- ============================================================
-- 028_client_intelligence_phase_a  (F3)  — living-knowledge brain (Phase A)
-- Foundation step 3 of 3. Run AFTER F1 (026) + F2 (027). Additive new tables, FK'd to clients.
-- content_artifacts = CANONICAL tagged store. RLS owner-only on every table.
-- Create order respects FKs: client_insights -> content_artifacts -> learning_signals -> insight_events
-- Reverse: drop table public.insight_events, public.learning_signals, public.content_artifacts, public.client_insights;
-- ============================================================

-- 1) client_insights — accumulating atoms (business / customers / bridge)
create table if not exists public.client_insights (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  owner_user_id     uuid not null references public.users(id) on delete cascade,
  layer             text not null check (layer in ('business','customers','bridge')),
  kind              text not null,
  content           text not null,
  structured        jsonb default '{}'::jsonb,
  source            text not null check (source in ('brief','user_signal','content_performance','ai_synthesis')),
  source_ref        jsonb default '{}'::jsonb,
  confidence        numeric(3,2) not null default 0.50 check (confidence >= 0 and confidence <= 1),
  evidence_count    int not null default 0,
  status            text not null default 'active' check (status in ('active','superseded','refuted')),
  superseded_by     uuid references public.client_insights(id) on delete set null,
  superseded_reason text,
  first_seen_at     timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists idx_insights_client_layer on public.client_insights(client_id, layer, status);
create index if not exists idx_insights_client_kind  on public.client_insights(client_id, kind, status);
create index if not exists idx_insights_owner        on public.client_insights(owner_user_id);
alter table public.client_insights enable row level security;
drop policy if exists client_insights_own on public.client_insights;
create policy client_insights_own on public.client_insights
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 2) content_artifacts — CANONICAL tagged store for every generated artifact
create table if not exists public.content_artifacts (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  type            text not null check (type in ('hook','post','creative_image','ad','campaign','message','landing')),
  parent_id       uuid references public.content_artifacts(id) on delete set null,
  content         jsonb not null default '{}'::jsonb,
  avatar_ref      jsonb,
  framework       text,
  angle           text,
  funnel_stage    text,
  hook_ref        uuid references public.content_artifacts(id) on delete set null,
  insight_ids     uuid[] not null default '{}',
  generated_from  jsonb default '{}'::jsonb,
  status          text not null default 'draft' check (status in ('draft','approved','rejected','published')),
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_artifacts_client_type on public.content_artifacts(client_id, type, status);
create index if not exists idx_artifacts_framework    on public.content_artifacts(client_id, framework);
create index if not exists idx_artifacts_funnel        on public.content_artifacts(client_id, funnel_stage);
create index if not exists idx_artifacts_insight_ids   on public.content_artifacts using gin (insight_ids);
alter table public.content_artifacts enable row level security;
drop policy if exists content_artifacts_own on public.content_artifacts;
create policy content_artifacts_own on public.content_artifacts
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 3) learning_signals — user (Phase A) + performance (Phase B) feedback
create table if not exists public.learning_signals (
  id            uuid primary key default uuid_generate_v4(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  artifact_id   uuid references public.content_artifacts(id) on delete set null,
  insight_id    uuid references public.client_insights(id) on delete set null,
  signal_type   text not null check (signal_type in ('user_worked','user_wrong','performance_win','performance_loss')),
  polarity      text not null check (polarity in ('positive','negative')),
  weight        numeric(3,2) not null default 0.50 check (weight >= 0 and weight <= 1),
  detail        text,
  metrics       jsonb default '{}'::jsonb,
  processed     boolean not null default false,
  created_at    timestamptz default now()
);
create index if not exists idx_signals_client_processed on public.learning_signals(client_id, processed);
create index if not exists idx_signals_artifact          on public.learning_signals(artifact_id);
create index if not exists idx_signals_insight           on public.learning_signals(insight_id);
alter table public.learning_signals enable row level security;
drop policy if exists learning_signals_own on public.learning_signals;
create policy learning_signals_own on public.learning_signals
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 4) insight_events — append-only audit (recoverability / explainability)
create table if not exists public.insight_events (
  id               uuid primary key default uuid_generate_v4(),
  insight_id       uuid not null references public.client_insights(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  owner_user_id    uuid not null references public.users(id) on delete cascade,
  event            text not null check (event in ('created','corroborated','weakened','superseded','refuted','reactivated')),
  delta_confidence numeric(4,3),
  signal_id        uuid references public.learning_signals(id) on delete set null,
  reason           text,
  created_at       timestamptz default now()
);
create index if not exists idx_insight_events_insight on public.insight_events(insight_id, created_at);
alter table public.insight_events enable row level security;
drop policy if exists insight_events_own on public.insight_events;
create policy insight_events_own on public.insight_events
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
