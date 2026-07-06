-- down for 053_approvals_published_status.sql
alter table public.approvals drop constraint if exists approvals_status_check;
alter table public.approvals add constraint approvals_status_check check (status in ('pending','approved','changes','rejected'));
alter table public.approvals drop column if exists published_at;
