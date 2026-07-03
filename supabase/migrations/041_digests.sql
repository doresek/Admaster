-- ============================================================
-- 041_digests — the weekly/monthly owner digest (VISION-DEEP §1.3), COMPOSED
-- from the decision ledger (campaign_decisions / diagnoses / hypotheses):
-- every clause in the narrative is a read from recorded rows — `sources`
-- carries the ids so the digest is an audit trail narrated, not generated
-- prose. Live sending is gated on C2 (InforU); rows persist as drafts.
-- ADDITIVE / REVERSIBLE. RLS owner-only. Reverse: 041_digests.down.sql
-- ============================================================

create table if not exists public.digests (
  id             uuid primary key default uuid_generate_v4(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  kind           text not null default 'weekly' check (kind in ('weekly','monthly')),
  period_start   date not null,
  period_end     date not null,
  -- structured sections (what ran / results / diagnoses / next week / approvals asked)
  content        jsonb not null default '{}'::jsonb,
  -- the Hebrew narrative rendered from `content`
  rendered_text  text not null default '',
  -- audit trail: {decision_ids[], diagnosis_ids[], hypothesis_ids[], campaign_ids[]}
  sources        jsonb not null default '{}'::jsonb,
  status         text not null default 'draft' check (status in ('draft','approved','sent')),
  created_at     timestamptz default now(),
  unique (client_id, kind, period_start)
);
create index if not exists idx_digests_client on public.digests(client_id, kind, period_start desc);
create index if not exists idx_digests_owner  on public.digests(owner_user_id);
alter table public.digests enable row level security;
drop policy if exists digests_own on public.digests;
create policy digests_own on public.digests
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
