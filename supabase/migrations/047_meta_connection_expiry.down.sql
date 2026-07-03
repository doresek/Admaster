begin;
alter table public.meta_connections drop column if exists token_expires_at;
commit;
