-- ============================================================
-- 035_episodic — C-02 episodic memory (pgvector) (MARKETING-CAPABILITIES-SPEC C-02)
-- ADDITIVE / REVERSIBLE. Enables pgvector, one new table + HNSW index + a
-- similarity-search RPC. Embedding dimension 768 (Google text-embedding-004;
-- pinned as a config constant in lib/episodic — a dimension change is a new
-- column/table, never an ALTER). Reverse: 035_episodic.down.sql
-- ============================================================

create extension if not exists vector;

-- episode_embeddings — one row per RESOLVED unit of experience (a resolved
-- hypothesis, a diagnosis, a verdicted campaign item/artifact), embedded for
-- k-NN recall at decision time. `abstracted_text` is the fleet-safe rendering
-- (no client names / verbatim copy) — fleet-scope recall reads ONLY that column.
create table if not exists public.episode_embeddings (
  id              uuid primary key default uuid_generate_v4(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  source_kind     text not null check (source_kind in ('hypothesis','diagnosis','campaign_item','artifact')),
  source_id       uuid not null,
  episode_text    text not null,            -- situation -> action -> outcome -> lesson (client-verbatim)
  abstracted_text text,                     -- fleet-safe abstraction; null until abstraction pass runs
  outcome         text not null default 'unknown'
                    check (outcome in ('win','loss','mixed','inconclusive','unknown')),
  insight_ids     uuid[] not null default '{}',
  metadata        jsonb not null default '{}'::jsonb,   -- {vertical?, funnel_stage?, domain?, embedder, dims}
  embedding       vector(768) not null,
  created_at      timestamptz default now()
);
create unique index if not exists idx_episodes_source on public.episode_embeddings(source_kind, source_id);
create index if not exists idx_episodes_client        on public.episode_embeddings(client_id);
create index if not exists idx_episodes_owner         on public.episode_embeddings(owner_user_id);
create index if not exists idx_episodes_insights      on public.episode_embeddings using gin (insight_ids);
create index if not exists idx_episodes_embedding     on public.episode_embeddings
  using hnsw (embedding vector_cosine_ops);
alter table public.episode_embeddings enable row level security;
drop policy if exists episode_embeddings_own on public.episode_embeddings;
create policy episode_embeddings_own on public.episode_embeddings
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);

-- match_episodes — cosine k-NN. SECURITY INVOKER (default): RLS applies for
-- authenticated callers; the server-side service-role client (the normal
-- background path) bypasses RLS as it does everywhere else.
-- p_scope: 'client' (this client's episodes, verbatim text) or 'fleet'
-- (other clients' episodes, abstracted_text only, and only rows that HAVE one).
create or replace function public.match_episodes(
  p_client_id uuid,
  p_query     vector(768),
  p_scope     text default 'client',
  p_k         int  default 5
) returns table (
  id uuid, source_kind text, source_id uuid, episode text,
  outcome text, insight_ids uuid[], metadata jsonb, similarity float
) language sql stable as $$
  select e.id, e.source_kind, e.source_id,
         case when p_scope = 'fleet' then e.abstracted_text else e.episode_text end as episode,
         e.outcome, e.insight_ids, e.metadata,
         1 - (e.embedding <=> p_query) as similarity
  from public.episode_embeddings e
  where case
          when p_scope = 'fleet'
            then e.client_id <> p_client_id and e.abstracted_text is not null
          else e.client_id = p_client_id
        end
  order by e.embedding <=> p_query
  limit greatest(1, least(p_k, 50));
$$;
