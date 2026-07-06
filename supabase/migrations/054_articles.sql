-- 054_articles.sql — P3-1 (ORGANIC-TASKS): the long-form content model.
--
-- Articles are client-scoped, atom-grounded long-form pieces (blog posts /
-- guides / listicles / video scripts) with an idea→outline→draft→review→published
-- lifecycle. They render on the client's site later (P2-4, site_pages) and are
-- exportable as text until then. ADDITIVE ONLY; RLS owner-only (051/052 convention).
-- Ledger: 052/053 = this lane (applied); planning session = 060+; 054 = next free.

create table if not exists public.articles (
  id             uuid primary key default uuid_generate_v4(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  owner_user_id  uuid not null references public.users(id) on delete cascade,
  site_id        uuid,                                   -- future FK → sites (P2-1 not landed; kept loose on purpose)
  slug           text not null,
  title          text not null,
  kind           text not null default 'article'
                   check (kind in ('article','listicle','guide','video_script')),
  outline        jsonb not null default '{}'::jsonb,     -- {h1, sections:[{h2,points[]}], faq:[{q}]}
  body_md        text,                                   -- final markdown (null until drafted)
  seo            jsonb not null default '{}'::jsonb,     -- {title, description, og, jsonld}
  keywords       text[] not null default '{}',           -- Hebrew-first target queries
  topic_source   jsonb not null default '{}'::jsonb,     -- the scored topic that seeded it (atom ids, intent, score)
  status         text not null default 'idea'
                   check (status in ('idea','outline','draft','review','published','archived')),
  grounded_in    uuid[] not null default '{}',           -- client_insights atoms behind the topic/content
  rationale      text,                                   -- plain-language WHY (Hebrew)
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (client_id, slug)
);

create index if not exists idx_articles_client_status on public.articles(client_id, status);
create index if not exists idx_articles_owner         on public.articles(owner_user_id);
create index if not exists idx_articles_grounded      on public.articles using gin (grounded_in);

alter table public.articles enable row level security;

drop policy if exists articles_owner_all on public.articles;
create policy articles_owner_all on public.articles
  for all
  using (auth.uid() = owner_user_id) with check (auth.uid() = owner_user_id);
