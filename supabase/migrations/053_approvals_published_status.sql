-- 053_approvals_published_status.sql — CP-2 follow-up: the pipeline's final state.
--
-- approvals.status CHECK was ('pending','approved','changes','rejected') — an
-- approved ad that got published had NO persistable state, so /publish could only
-- mark "פורסם ✓" in session memory. Widen the CHECK with 'published' (constraint
-- swap; values-preserving, additive in effect — house precedent: mig 048) and add
-- published_at. Command-center lanes + /publish can now show approved → published.
alter table public.approvals
  drop constraint if exists approvals_status_check;
alter table public.approvals
  add constraint approvals_status_check
  check (status in ('pending','approved','changes','rejected','published'));

alter table public.approvals
  add column if not exists published_at timestamptz;
