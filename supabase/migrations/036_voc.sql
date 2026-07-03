-- ============================================================
-- 036_voc — C-08 voice-of-customer ingestion (MARKETING-CAPABILITIES-SPEC C-08)
-- ADDITIVE / REVERSIBLE. Two new tables, RLS owner-only, conventions per 030.
-- Reverse: 036_voc.down.sql
-- ============================================================

-- voc_documents — one ingested source document (a paste of reviews, a comment
-- batch, a sales thread). raw_hash dedupes re-ingestion of the same content.
create table if not exists public.voc_documents (
  id             uuid primary key default uuid_generate_v4(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  source         text not null check (source in
                   ('own_reviews','competitor_reviews','ad_comments','community','sales_thread','manual')),
  source_meta    jsonb not null default '{}'::jsonb,   -- {platform?, url?, competitor_name?, note?}
  raw_text       text not null,
  raw_hash       text not null,
  quote_count    int not null default 0,
  status         text not null default 'ingested'
                   check (status in ('ingested','extracted','reconciled','failed')),
  error          text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique (client_id, raw_hash)
);
create index if not exists idx_voc_documents_client on public.voc_documents(client_id, status);
create index if not exists idx_voc_documents_owner  on public.voc_documents(owner_user_id);
alter table public.voc_documents enable row level security;
drop policy if exists voc_documents_own on public.voc_documents;
create policy voc_documents_own on public.voc_documents
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- voc_quotes — one verbatim, PII-stripped customer quote, typed by extractable.
-- atom_action records the reconciliation outcome (which insight it corroborated /
-- created / contradicted) for full quote->atom traceability.
create table if not exists public.voc_quotes (
  id             uuid primary key default uuid_generate_v4(),
  document_id    uuid not null references public.voc_documents(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  quote          text not null,                        -- verbatim, PII-stripped
  extractable    text not null check (extractable in
                   ('pain','desire','objection','alternative','trigger','proof','identity')),
  polarity       text not null default 'neutral' check (polarity in ('positive','negative','neutral')),
  segment_tags   jsonb not null default '{}'::jsonb,   -- {gender?, age_hint?, role?, geo?}
  atom_action    jsonb,                                -- {action: corroborated|created|contradicted|skipped, insight_id?, signal_id?, reason?}
  funnel_fit     text,                                 -- TOFU|MOFU|BOFU copy-ammunition hint
  created_at     timestamptz default now()
);
create index if not exists idx_voc_quotes_client_extract on public.voc_quotes(client_id, extractable);
create index if not exists idx_voc_quotes_document       on public.voc_quotes(document_id);
create index if not exists idx_voc_quotes_owner          on public.voc_quotes(owner_user_id);
alter table public.voc_quotes enable row level security;
drop policy if exists voc_quotes_own on public.voc_quotes;
create policy voc_quotes_own on public.voc_quotes
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
