-- ============================================================
-- 037_strategy_objects — C-10 messaging architecture + funnel-as-object
-- (MARKETING-CAPABILITIES-SPEC C-10). ADDITIVE / REVERSIBLE. Two new tables,
-- RLS owner-only, conventions per 030. Reverse: 037_strategy_objects.down.sql
-- ============================================================

-- message_architectures — versioned projection of the active atoms into
-- core promise -> pillars -> proof map. Never edited in place: a re-synthesis
-- inserts the next version (append-only, like everything the brain produces).
create table if not exists public.message_architectures (
  id             uuid primary key default uuid_generate_v4(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  version        int not null,
  core_promise   jsonb not null,                 -- {text, insight_id, confidence}
  pillars        jsonb not null,                 -- [{key, title, kind_cluster, insight_ids[], awareness_notes}]
  proof_map      jsonb not null default '[]'::jsonb, -- [{proof_insight_id, pillar_key}]
  unassigned     jsonb not null default '[]'::jsonb, -- proof atoms with no pillar (unused ammunition flags)
  grounded_in    uuid[] not null default '{}',
  synth_meta     jsonb not null default '{}'::jsonb, -- {atom_count, avg_confidence, trigger}
  created_at     timestamptz default now(),
  unique (client_id, version)
);
create index if not exists idx_msg_arch_client on public.message_architectures(client_id, version desc);
create index if not exists idx_msg_arch_owner  on public.message_architectures(owner_user_id);
alter table public.message_architectures enable row level security;
drop policy if exists message_architectures_own on public.message_architectures;
create policy message_architectures_own on public.message_architectures
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- funnels — the designed path as an object: nodes install beliefs (atoms),
-- edges carry expected conversion WITH provenance (client baseline | playbook
-- prior | declared guess) so diagnosis can localize to the worst edge honestly.
create table if not exists public.funnels (
  id             uuid primary key default uuid_generate_v4(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  campaign_id    uuid references public.campaigns(id) on delete set null,
  name           text not null,
  awareness_entry text,                          -- Schwartz entry level the funnel is designed for
  nodes          jsonb not null,                 -- [{key, kind, belief_installed:{insight_id?, text}, asset_ref?}]
  edges          jsonb not null,                 -- [{from, to, event, expected:{rate, provenance}, actual?:{rate, n}}]
  grounded_in    uuid[] not null default '{}',
  status         text not null default 'draft' check (status in ('draft','active','archived')),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
create index if not exists idx_funnels_client   on public.funnels(client_id, status);
create index if not exists idx_funnels_owner    on public.funnels(owner_user_id);
create index if not exists idx_funnels_campaign on public.funnels(campaign_id);
alter table public.funnels enable row level security;
drop policy if exists funnels_own on public.funnels;
create policy funnels_own on public.funnels
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
