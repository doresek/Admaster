-- ============================================================
-- 029_repoint_fks_to_clients  (M3)  — swap all 16 client_id FKs meta_clients -> clients
-- PREPARED, NOT APPLIED. Review + run in the morning.
-- Safe: clients.id == meta_clients.id (1:1, backfill verified 4=4), so every existing
--       client_id already exists in clients -> zero orphans. The ADD CONSTRAINT validates
--       existing rows; the whole thing is wrapped in one transaction (all-or-nothing).
-- Reverse: re-run with "references public.meta_clients(id)" instead of clients(id).
-- ============================================================

-- ---- PREFLIGHT (optional, read-only): expect every count = 0 before swapping ----
-- select 'ad_performance' t, count(*) n from public.ad_performance   x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'approvals',        count(*) from public.approvals        x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'autopilot_runs',   count(*) from public.autopilot_runs   x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'brief_codes',      count(*) from public.brief_codes      x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'briefs',           count(*) from public.briefs           x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'client_journeys',  count(*) from public.client_journeys  x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'generated_content',count(*) from public.generated_content x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'generated_images', count(*) from public.generated_images x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'landing_pages',    count(*) from public.landing_pages    x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'launched_ads',     count(*) from public.launched_ads     x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'message_series',   count(*) from public.message_series   x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'messages',         count(*) from public.messages         x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'offer_stacks',     count(*) from public.offer_stacks     x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'pixels',           count(*) from public.pixels           x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'reports',          count(*) from public.reports          x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id)
-- union all select 'scheduled_posts',  count(*) from public.scheduled_posts  x where x.client_id is not null and not exists (select 1 from public.clients c where c.id=x.client_id);

-- ---- THE SWAP (atomic) ----
begin;

-- CASCADE on delete
alter table public.ad_performance  drop constraint ad_performance_client_id_fkey;
alter table public.ad_performance  add  constraint ad_performance_client_id_fkey  foreign key (client_id) references public.clients(id) on delete cascade;
alter table public.autopilot_runs  drop constraint autopilot_runs_client_id_fkey;
alter table public.autopilot_runs  add  constraint autopilot_runs_client_id_fkey  foreign key (client_id) references public.clients(id) on delete cascade;
alter table public.brief_codes     drop constraint brief_codes_client_id_fkey;
alter table public.brief_codes     add  constraint brief_codes_client_id_fkey     foreign key (client_id) references public.clients(id) on delete cascade;
alter table public.client_journeys drop constraint client_journeys_client_id_fkey;
alter table public.client_journeys add  constraint client_journeys_client_id_fkey foreign key (client_id) references public.clients(id) on delete cascade;
alter table public.pixels          drop constraint pixels_client_id_fkey;
alter table public.pixels          add  constraint pixels_client_id_fkey          foreign key (client_id) references public.clients(id) on delete cascade;
alter table public.reports         drop constraint reports_client_id_fkey;
alter table public.reports         add  constraint reports_client_id_fkey         foreign key (client_id) references public.clients(id) on delete cascade;
alter table public.scheduled_posts drop constraint scheduled_posts_client_id_fkey;
alter table public.scheduled_posts add  constraint scheduled_posts_client_id_fkey foreign key (client_id) references public.clients(id) on delete cascade;

-- SET NULL on delete
alter table public.approvals         drop constraint approvals_client_id_fkey;
alter table public.approvals         add  constraint approvals_client_id_fkey         foreign key (client_id) references public.clients(id) on delete set null;
alter table public.briefs            drop constraint briefs_client_id_fkey;
alter table public.briefs            add  constraint briefs_client_id_fkey            foreign key (client_id) references public.clients(id) on delete set null;
alter table public.generated_content drop constraint generated_content_client_id_fkey;
alter table public.generated_content add  constraint generated_content_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null;
alter table public.generated_images  drop constraint generated_images_client_id_fkey;
alter table public.generated_images  add  constraint generated_images_client_id_fkey  foreign key (client_id) references public.clients(id) on delete set null;
alter table public.landing_pages     drop constraint landing_pages_client_id_fkey;
alter table public.landing_pages     add  constraint landing_pages_client_id_fkey     foreign key (client_id) references public.clients(id) on delete set null;
alter table public.launched_ads      drop constraint launched_ads_client_id_fkey;
alter table public.launched_ads      add  constraint launched_ads_client_id_fkey      foreign key (client_id) references public.clients(id) on delete set null;
alter table public.message_series    drop constraint message_series_client_id_fkey;
alter table public.message_series    add  constraint message_series_client_id_fkey    foreign key (client_id) references public.clients(id) on delete set null;
alter table public.messages          drop constraint messages_client_id_fkey;
alter table public.messages          add  constraint messages_client_id_fkey          foreign key (client_id) references public.clients(id) on delete set null;
alter table public.offer_stacks      drop constraint offer_stacks_client_id_fkey;
alter table public.offer_stacks      add  constraint offer_stacks_client_id_fkey      foreign key (client_id) references public.clients(id) on delete set null;

commit;

-- ---- POST-VERIFY (read-only): all 16 should now show foreign_table = clients ----
-- select tc.table_name, ccu.table_name as foreign_table
-- from information_schema.table_constraints tc
-- join information_schema.constraint_column_usage ccu
--   on ccu.constraint_name = tc.constraint_name and ccu.constraint_schema = tc.constraint_schema
-- where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public'
--   and tc.constraint_name like '%_client_id_fkey'
-- order by tc.table_name;
