-- down for 052_contacts_retention.sql
drop function if exists public.retention_opt_out(text, text);
drop table if exists public.series_enrollments;
drop table if exists public.contact_touches;
drop table if exists public.client_contacts;
alter table public.message_series
  drop column if exists audience_tags,
  drop column if exists activated_at,
  drop column if exists approval_event_id,
  drop column if exists grounded_in,
  drop column if exists rationale;
alter table public.series_messages
  drop column if exists promo_key,
  drop column if exists grounded_in;
alter table public.clients drop column if exists retention_policy;
