-- ============================================================
-- 060_measurement_spine — attribution + funnel tracking + unit economics
-- (MEASUREMENT-SPINE-PLAN.md, owner-approved 2026-07-06).
-- NUMBER RESERVATION: both branches (main + feat/content-pipeline-wave-1)
-- top out at 051 at authoring time; the security session is about to write
-- more, so this session reserves 060–063 (non-contiguous is safe; zero race).
-- ADDITIVE / REVERSIBLE. RLS owner-only on every table (030 conventions).
-- Ground truth at authoring: no canonical lead registry exists (only
-- landing_page_leads + contacts) → funnel_leads becomes the canonical
-- client-scoped registry all capture points write into.
-- Reverse: 060_measurement_spine.down.sql
-- ============================================================

-- 1) funnel_leads — the canonical lead registry (one row per human lead).
create table if not exists public.funnel_leads (
  id                   uuid primary key default uuid_generate_v4(),
  client_id            uuid not null references public.clients(id) on delete cascade,
  owner_user_id        uuid not null references public.users(id) on delete cascade,
  source               text not null default 'landing'
                         check (source in ('landing','site','whatsapp','instant_form','call','manual')),
  source_ref           jsonb not null default '{}'::jsonb,   -- {landing_page_id?, landing_page_lead_id?, campaign_item_id?}
  name                 text,
  phone                text,
  email                text,
  -- IL law (חוק הספאם 30א + תיקון 13): marketing consent is explicit, unchecked-by-default,
  -- recorded with a timestamp; retention sends require consent_marketing = true.
  consent_marketing    boolean not null default false,
  consent_recorded_at  timestamptz,
  current_stage        text not null default 'new'
                         check (current_stage in ('new','contacted','qualified','meeting','closed_won','closed_lost','irrelevant')),
  value                numeric(12,2),                        -- closed value when known (ILS)
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);
create index if not exists idx_funnel_leads_client_stage on public.funnel_leads(client_id, current_stage);
create index if not exists idx_funnel_leads_owner        on public.funnel_leads(owner_user_id);
create index if not exists idx_funnel_leads_created      on public.funnel_leads(client_id, created_at desc);
alter table public.funnel_leads enable row level security;
drop policy if exists funnel_leads_own on public.funnel_leads;
create policy funnel_leads_own on public.funnel_leads
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 2) lead_touchpoints — the attribution identity capture (L0). Attribution
--    without stored click IDs is guessing; this row is what makes a lead
--    traceable to the exact ad/item/page that produced it.
create table if not exists public.lead_touchpoints (
  id             uuid primary key default uuid_generate_v4(),
  lead_id        uuid not null references public.funnel_leads(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  fbclid         text,
  gclid          text,
  ctwa_clid      text,                                       -- WhatsApp CTWA (C2-gated capture)
  meta_lead_id   text,                                       -- Instant Forms lead id
  utm            jsonb not null default '{}'::jsonb,         -- {source, medium, campaign, content(=campaign_item_id), term}
  landing_path   text,
  referrer       text,
  user_agent     text,
  captured_at    timestamptz default now()
);
create index if not exists idx_touchpoints_lead   on public.lead_touchpoints(lead_id);
create index if not exists idx_touchpoints_client on public.lead_touchpoints(client_id, captured_at desc);
create index if not exists idx_touchpoints_owner  on public.lead_touchpoints(owner_user_id);
alter table public.lead_touchpoints enable row level security;
drop policy if exists lead_touchpoints_own on public.lead_touchpoints;
create policy lead_touchpoints_own on public.lead_touchpoints
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 3) lead_stage_events — append-only stage history (the CRM ground truth).
create table if not exists public.lead_stage_events (
  id             uuid primary key default uuid_generate_v4(),
  lead_id        uuid not null references public.funnel_leads(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  stage          text not null
                   check (stage in ('new','contacted','qualified','meeting','closed_won','closed_lost','irrelevant')),
  value          numeric(12,2),                              -- on closed_won
  marked_via     text not null default 'ui'
                   check (marked_via in ('system','ui','digest','whatsapp')),
  note           text,
  created_at     timestamptz default now()
);
create index if not exists idx_stage_events_lead   on public.lead_stage_events(lead_id, created_at);
create index if not exists idx_stage_events_client on public.lead_stage_events(client_id, stage, created_at desc);
create index if not exists idx_stage_events_owner  on public.lead_stage_events(owner_user_id);
alter table public.lead_stage_events enable row level security;
drop policy if exists lead_stage_events_own on public.lead_stage_events;
create policy lead_stage_events_own on public.lead_stage_events
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 4) client_economics — unit-economics inputs (owner-seeded, data-updated).
--    break-even ROAS = 1/contribution margin is COMPUTED, never stored.
create table if not exists public.client_economics (
  id                      uuid primary key default uuid_generate_v4(),
  client_id               uuid not null unique references public.clients(id) on delete cascade,
  owner_user_id           uuid not null references public.users(id) on delete cascade,
  contribution_margin_pct numeric(5,2) check (contribution_margin_pct > 0 and contribution_margin_pct <= 100),
  avg_deal_value          numeric(12,2) check (avg_deal_value >= 0),
  close_rate_pct          numeric(5,2) check (close_rate_pct >= 0 and close_rate_pct <= 100),
  payback_target_months   int not null default 6 check (payback_target_months between 1 and 36),
  currency                text not null default 'ILS',
  source                  text not null default 'owner' check (source in ('owner','computed','mixed')),
  updated_at              timestamptz default now(),
  created_at              timestamptz default now()
);
create index if not exists idx_client_economics_owner on public.client_economics(owner_user_id);
alter table public.client_economics enable row level security;
drop policy if exists client_economics_own on public.client_economics;
create policy client_economics_own on public.client_economics
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 5) channel_reconciliation — platform-claimed vs CRM truth per channel/period.
create table if not exists public.channel_reconciliation (
  id                uuid primary key default uuid_generate_v4(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  owner_user_id     uuid not null references public.users(id) on delete cascade,
  channel           text not null,                            -- meta_paid | meta_organic | google | whatsapp | direct
  period_start      date not null,
  period_end        date not null,
  platform_claimed  numeric(12,2) not null default 0,         -- conversions the platform claims
  crm_truth         numeric(12,2) not null default 0,         -- funnel_leads reality
  ratio             numeric(8,4),                             -- claimed/truth; null when truth=0
  note              text,
  created_at        timestamptz default now(),
  unique (client_id, channel, period_start)
);
create index if not exists idx_reconciliation_client on public.channel_reconciliation(client_id, period_start desc);
create index if not exists idx_reconciliation_owner  on public.channel_reconciliation(owner_user_id);
alter table public.channel_reconciliation enable row level security;
drop policy if exists channel_reconciliation_own on public.channel_reconciliation;
create policy channel_reconciliation_own on public.channel_reconciliation
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 6) WIDEN learning_signals.signal_type (additive): sales outcomes reach the brain.
alter table public.learning_signals drop constraint if exists learning_signals_signal_type_check;
alter table public.learning_signals add constraint learning_signals_signal_type_check
  check (signal_type in (
    'user_worked','user_wrong','performance_win','performance_loss',
    'hypothesis_supported','hypothesis_refuted','voc_evidence','competitor_evidence',
    'sales_outcome'
  ));
