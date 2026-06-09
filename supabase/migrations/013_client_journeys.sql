-- ============================================================
-- 013: Client Journey model + Autopilot runs + onboarding state.
--
-- Phase 1 "broad foundation": a per-client funnel state machine that
-- ties the existing (disconnected) modules — brief → generate → approve
-- → launch → analyze → improve — into one beginner-friendly journey, plus
-- the autopilot "do it for me" run record and first-run onboarding state.
--
-- Platform-agnostic: pointer columns are soft uuids (no cross-branch FK),
-- so this applies cleanly regardless of which feature branch is deployed
-- (launched_ads lives on a separate branch). user_id/client_id FK only to
-- core tables that always exist.
--
-- Idempotent — safe to run on prod as-is.
-- ============================================================

-- ── CLIENT JOURNEYS — one row per (user, client) ────────────
create table if not exists public.client_journeys (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.users(id) on delete cascade not null,
  client_id       uuid references public.meta_clients(id) on delete cascade,
  state           text not null default 'needs_brief'
                    check (state in (
                      'needs_client','needs_brief','brief_in','generating',
                      'scoring','awaiting_approval','ready_to_launch','live',
                      'analyzing','optimizing','needs_attention'
                    )),
  mode            text not null default 'manual' check (mode in ('manual','autopilot')),
  brief_id        uuid,           -- soft ref → briefs
  approval_id     uuid,           -- soft ref → approvals
  launched_ad_id  uuid,           -- soft ref → launched_ads (lives on another branch)
  current_run_id  uuid,           -- soft ref → autopilot_runs
  next_action     jsonb default '{}'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (user_id, client_id)
);

create index if not exists idx_journeys_user        on public.client_journeys(user_id);
create index if not exists idx_journeys_user_client on public.client_journeys(user_id, client_id);

alter table public.client_journeys enable row level security;
drop policy if exists "own" on public.client_journeys;
create policy "own" on public.client_journeys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── JOURNEY EVENTS — append-only timeline / judge seam ──────
create table if not exists public.journey_events (
  id          uuid default uuid_generate_v4() primary key,
  journey_id  uuid references public.client_journeys(id) on delete cascade not null,
  user_id     uuid references public.users(id) on delete cascade not null,
  step        text,
  from_state  text,
  to_state    text,
  status      text default 'ok' check (status in ('ok','error','skipped','gate')),
  payload     jsonb default '{}'::jsonb,   -- step result, score, judge verdict, error
  created_at  timestamptz default now()
);

create index if not exists idx_journey_events_journey on public.journey_events(journey_id, created_at desc);

alter table public.journey_events enable row level security;
drop policy if exists "own" on public.journey_events;
create policy "own" on public.journey_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── AUTOPILOT RUNS — live orchestration record ──────────────
create table if not exists public.autopilot_runs (
  id           uuid default uuid_generate_v4() primary key,
  user_id      uuid references public.users(id) on delete cascade not null,
  client_id    uuid references public.meta_clients(id) on delete cascade,
  journey_id   uuid references public.client_journeys(id) on delete set null,
  status       text not null default 'running'
                 check (status in ('running','awaiting_approval','done','failed','cancelled')),
  current_step text,
  steps        jsonb default '[]'::jsonb,   -- [{name, status, at, data?}]
  result       jsonb default '{}'::jsonb,
  error        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists idx_autopilot_runs_user    on public.autopilot_runs(user_id, created_at desc);
create index if not exists idx_autopilot_runs_journey on public.autopilot_runs(journey_id);

alter table public.autopilot_runs enable row level security;
drop policy if exists "own" on public.autopilot_runs;
create policy "own" on public.autopilot_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── ONBOARDING state on users ───────────────────────────────
alter table public.users
  add column if not exists onboarding jsonb not null default '{}'::jsonb;
