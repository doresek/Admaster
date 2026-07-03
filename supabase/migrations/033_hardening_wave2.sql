-- ============================================================
-- 033_hardening_wave2 — idempotency key for performance ingestion (C5)
-- Additive. Pure ASCII. Idempotent. No destructive ops.
--
-- C5: re-ingesting the same Meta window must not insert duplicate content_performance
--     rows (each duplicate drives a diagnosis + re-weakens the same atoms). A unique
--     key on (client_id, ad_id, period_start, period_end) lets ingestion upsert
--     (on conflict do update) instead of blind-insert. NULL ad_id rows (manual entries)
--     stay distinct under standard UNIQUE semantics, so manual rows are unaffected.
--
-- Reverse: 033_hardening_wave2.down.sql
-- ============================================================

-- ---- PREFLIGHT (read-only): expect ZERO rows. Any row = an existing duplicate that
--      must be de-duped before the unique index can be created.
-- select client_id, ad_id, period_start, period_end, count(*)
--   from public.content_performance
--  where ad_id is not null and period_start is not null and period_end is not null
--  group by client_id, ad_id, period_start, period_end having count(*) > 1;

begin;

create unique index if not exists content_performance_window_uniq
  on public.content_performance(client_id, ad_id, period_start, period_end);

commit;

-- ---- POST-VERIFY (read-only) ----
-- select indexname from pg_indexes
--  where tablename='content_performance' and indexname='content_performance_window_uniq';
