-- ============================================================
-- AdMaster Pro — Schema Update v4 (Phase B)
-- Landing pages, support tickets, credit top-ups,
-- content favorites/tags/folders, brief completion %.
-- Run AFTER 003_messages_and_series.sql
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- LANDING PAGES
-- ────────────────────────────────────────────────────────────
create table public.landing_pages (
  id            uuid default uuid_generate_v4() primary key,
  user_id       uuid references public.users(id) on delete cascade not null,
  client_id     uuid references public.meta_clients(id) on delete set null,
  slug          text not null unique,
  title         text not null,
  template      text not null check (template in ('squeeze','local_service','vsl','launch','application','webinar','custom')),
  content       jsonb not null default '{}'::jsonb,
  -- content shape (varies per template):
  -- { hero_title, hero_sub, cta_label, cta_href, sections: [...], theme: {primary,secondary}, video_url?, form_fields? }
  views         int  default 0,
  conversions   int  default 0,
  status        text default 'draft' check (status in ('draft','published','archived')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index idx_lp_user on public.landing_pages(user_id);
create index idx_lp_slug on public.landing_pages(slug);

alter table public.landing_pages enable row level security;
create policy "own"    on public.landing_pages using (auth.uid() = user_id);
-- Public can SELECT published pages (for the /lp/[slug] viewer)
create policy "public_published" on public.landing_pages
  for select to anon, authenticated using (status = 'published');

-- ────────────────────────────────────────────────────────────
-- LANDING PAGE LEADS (form submissions)
-- ────────────────────────────────────────────────────────────
create table public.landing_page_leads (
  id              uuid default uuid_generate_v4() primary key,
  landing_page_id uuid references public.landing_pages(id) on delete cascade not null,
  user_id         uuid references public.users(id) on delete cascade not null,
  fields          jsonb not null default '{}'::jsonb,
  user_agent      text,
  referrer        text,
  created_at      timestamptz default now()
);

create index idx_lp_leads_page on public.landing_page_leads(landing_page_id);
create index idx_lp_leads_user on public.landing_page_leads(user_id);

alter table public.landing_page_leads enable row level security;
create policy "own"        on public.landing_page_leads using (auth.uid() = user_id);
create policy "public_insert" on public.landing_page_leads
  for insert to anon, authenticated with check (true);

-- ────────────────────────────────────────────────────────────
-- SUPPORT TICKETS
-- ────────────────────────────────────────────────────────────
create table public.support_tickets (
  id          uuid default uuid_generate_v4() primary key,
  user_id     uuid references public.users(id) on delete cascade not null,
  subject     text not null,
  category    text default 'general' check (category in ('general','billing','bug','feature_request','meta_api','other')),
  status      text default 'open' check (status in ('open','in_progress','waiting','resolved','closed')),
  priority    text default 'normal' check (priority in ('low','normal','high','urgent')),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table public.support_messages (
  id          uuid default uuid_generate_v4() primary key,
  ticket_id   uuid references public.support_tickets(id) on delete cascade not null,
  author_id   uuid references public.users(id) on delete set null,
  body        text not null,
  is_staff    boolean default false,
  created_at  timestamptz default now()
);

create index idx_tickets_user    on public.support_tickets(user_id);
create index idx_tickets_status  on public.support_tickets(status, updated_at desc);
create index idx_messages_ticket on public.support_messages(ticket_id, created_at);

alter table public.support_tickets  enable row level security;
alter table public.support_messages enable row level security;

create policy "own" on public.support_tickets using (auth.uid() = user_id);
create policy "via_ticket" on public.support_messages
  using (ticket_id in (select id from public.support_tickets where user_id = auth.uid()));

-- ────────────────────────────────────────────────────────────
-- CREDIT TOP-UPS (one-time purchases)
-- ────────────────────────────────────────────────────────────
create table public.credit_topups (
  id              uuid default uuid_generate_v4() primary key,
  user_id         uuid references public.users(id) on delete cascade not null,
  credits         int  not null check (credits > 0),
  amount_ils      numeric(10,2) not null,
  stripe_session  text,
  status          text default 'pending' check (status in ('pending','paid','failed','refunded')),
  created_at      timestamptz default now(),
  completed_at    timestamptz
);

create index idx_topups_user on public.credit_topups(user_id, created_at desc);

alter table public.credit_topups enable row level security;
create policy "own" on public.credit_topups using (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────
-- AD LIBRARY — favorites, tags, folders on generated_content
-- ────────────────────────────────────────────────────────────
alter table public.generated_content
  add column if not exists favorite     boolean default false,
  add column if not exists tags         text[]  default '{}',
  add column if not exists folder       text,
  add column if not exists client_id    uuid references public.meta_clients(id) on delete set null,
  add column if not exists title        text;

create index if not exists idx_content_favorite  on public.generated_content(user_id, favorite) where favorite = true;
create index if not exists idx_content_folder    on public.generated_content(user_id, folder);
create index if not exists idx_content_client    on public.generated_content(client_id);

-- ────────────────────────────────────────────────────────────
-- BRIEF COMPLETION % (computed via SQL function on demand)
-- ────────────────────────────────────────────────────────────
create or replace function public.brief_completion_pct(brief_values jsonb)
returns int language plpgsql immutable as $$
declare
  -- the canonical brief field list (mirrors types/index.ts BriefValues)
  required text[] := array[
    'biz_name','biz_what','biz_result','biz_time','biz_price','biz_usp',
    'cust_who','cust_income','pain_main','pain_internal','desire_dream',
    'obj_main','obj_tried','obj_fear','mkt_awareness',
    'offer_anchor','offer_price','offer_bonuses','offer_guarantee','offer_urgency','offer_cta'
  ];
  filled int := 0;
  k       text;
begin
  if brief_values is null then return 0; end if;
  foreach k in array required loop
    if coalesce(trim(brief_values ->> k), '') <> '' then
      filled := filled + 1;
    end if;
  end loop;
  return round(filled::numeric * 100 / cardinality(required));
end;
$$;

-- ────────────────────────────────────────────────────────────
-- CSV EXPORT helper — get credit history flat
-- ────────────────────────────────────────────────────────────
create or replace function public.credit_history_export(p_user_id uuid)
returns table (
  date_at timestamptz,
  action  text,
  cost    int,
  meta    jsonb
)
language sql stable security definer as $$
  select created_at, action, cost, meta
  from public.credit_history
  where user_id = p_user_id
  order by created_at desc;
$$;

grant execute on function public.brief_completion_pct(jsonb) to authenticated;
grant execute on function public.credit_history_export(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────
-- 30-DAY USAGE — rollup function for dashboard chart
-- ────────────────────────────────────────────────────────────
create or replace function public.credit_usage_30d(p_user_id uuid)
returns table (
  day   date,
  used  int
)
language sql stable security definer as $$
  select d::date as day,
         coalesce(sum(h.cost)::int, 0) as used
  from generate_series((now() - interval '29 days')::date, now()::date, interval '1 day') as d
  left join public.credit_history h
    on h.user_id = p_user_id
   and h.created_at::date = d::date
  group by d
  order by d;
$$;

grant execute on function public.credit_usage_30d(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────
-- Landing Page counters (anon can increment via RPCs only)
-- ────────────────────────────────────────────────────────────
create or replace function public.increment_lp_view(p_slug text)
returns void language sql security definer as $$
  update public.landing_pages set views = views + 1 where slug = p_slug and status = 'published';
$$;

create or replace function public.increment_lp_conversion(p_page_id uuid)
returns void language sql security definer as $$
  update public.landing_pages set conversions = conversions + 1 where id = p_page_id;
$$;

grant execute on function public.increment_lp_view(text)       to anon, authenticated;
grant execute on function public.increment_lp_conversion(uuid) to anon, authenticated;
