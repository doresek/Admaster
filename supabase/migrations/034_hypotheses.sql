-- ============================================================
-- 034_hypotheses — C-01 pre-registered hypothesis ledger (MARKETING-CAPABILITIES-SPEC C-01)
-- ADDITIVE / REVERSIBLE. One new table + a WIDENED (never narrowed) CHECK on
-- learning_signals.signal_type so hypothesis resolutions and VoC evidence can
-- flow through the existing lifecycle engine as first-class signals.
-- RLS owner-only, conventions per 030. Reverse: 034_hypotheses.down.sql
-- ============================================================

-- 1) hypotheses — every material decision/test as a falsifiable, PRE-REGISTERED claim.
--    Registration criteria are FROZEN at launch (immutability by supersession:
--    edits create a new row and point superseded_by — same doctrine as client_insights).
create table if not exists public.hypotheses (
  id             uuid primary key default uuid_generate_v4(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  -- the atoms this bet rests on (client_insights ids)
  insight_ids    uuid[] not null default '{}',
  claim          text not null,
  -- frozen at registration:
  prediction     jsonb not null,                 -- {metric, comparator, baseline_arm?, min_effect, confidence}
  floor_spec     jsonb not null,                 -- {metric_grade: 'ctr'|'cvr'|'cpa'|'lead_quality', per_arm: {...}}
  horizon        jsonb not null,                 -- {max_days?, max_spend?}
  verdict_map    jsonb not null,                 -- {supported:[{insight_id,polarity,weight}], refuted:[...], inconclusive:[]}
  kill_rules     jsonb not null default '{}'::jsonb,  -- {mercy:{...}, catastrophic:{...}}
  -- test wiring + calibration domain
  test_refs      jsonb not null default '[]'::jsonb,  -- [{campaign_item_id?, arm_label}]
  domain         text not null default 'other'
                   check (domain in ('angle','audience','offer','creative','funnel','timing','channel','other')),
  status         text not null default 'open'
                   check (status in ('open','supported','refuted','inconclusive','killed','superseded')),
  resolution     jsonb,                          -- {observed, verdict_reason, brier?, resolved_by}
  registered_at  timestamptz not null default now(),
  resolved_at    timestamptz,
  superseded_by  uuid references public.hypotheses(id) on delete set null,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_hypotheses_client_status on public.hypotheses(client_id, status);
create index if not exists idx_hypotheses_owner         on public.hypotheses(owner_user_id);
create index if not exists idx_hypotheses_insights      on public.hypotheses using gin (insight_ids);
create index if not exists idx_hypotheses_domain        on public.hypotheses(domain, status);
alter table public.hypotheses enable row level security;
drop policy if exists hypotheses_own on public.hypotheses;
create policy hypotheses_own on public.hypotheses
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- 2) WIDEN learning_signals.signal_type (additive: all previously-valid values remain valid).
--    New: hypothesis_supported / hypothesis_refuted (C-01 resolutions move atoms
--    through the lifecycle with experiment provenance) and voc_evidence (C-08).
alter table public.learning_signals drop constraint if exists learning_signals_signal_type_check;
alter table public.learning_signals add constraint learning_signals_signal_type_check
  check (signal_type in (
    'user_worked','user_wrong','performance_win','performance_loss',
    'hypothesis_supported','hypothesis_refuted','voc_evidence'
  ));
