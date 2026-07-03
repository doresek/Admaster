-- ============================================================
-- 045_heartbeat_claim_uniq — close the heartbeat claim TOCTOU (SECURITY-AUDIT-2
-- HB-1). Migration 039 gave heartbeat_runs NO unique constraint over
-- (client_id, tick_type, period), so claimTick's check-then-insert let two
-- concurrent runHeartbeat invocations both pass the period read and both claim
-- + run the same tick -> duplicate hypotheses / autonomy proposals and a
-- corrupt ledger (two 'succeeded' rows for one period).
--
-- FIX (additive / idempotent, pure ASCII): add a stable per-period identity
-- column period_key text, backfill it from the existing period columns
-- (tick_type + created_at), then add a PARTIAL UNIQUE INDEX over
-- (client_id, tick_type, period_key) restricted to the LIVE / DONE statuses
-- ('claimed','running','succeeded'). Failed/skipped rows are intentionally
-- excluded so a failed run can still be retried within the same period (matches
-- claimTick's existing "only success blocks a re-claim" contract). The INSERT
-- then becomes the atomic arbiter of the claim: the loser of a race gets a
-- 23505 and backs off cleanly instead of double-ticking.
--
-- period_key format = the UTC period-start date as 'YYYY-MM-DD' (matches
-- ledger.ts periodKey(): periodStart(tick, now).toISOString().slice(0,10)):
--   daily   -> the UTC calendar day        (date_trunc 'day')
--   weekly  -> the ISO week's Monday        (date_trunc 'week' = Monday in PG)
--   monthly -> the UTC calendar month start (date_trunc 'month')
--
-- heartbeat_runs is EMPTY on prod (0 rows) so the backfill is a no-op there;
-- the logic is written to be correct for any existing rows regardless.
-- Reverse: 045_heartbeat_claim_uniq.down.sql
-- ============================================================

-- ---- PREFLIGHT (read-only; run manually before applying) -------------------
-- Confirms the additive index can be created (no pre-existing live/done dupes).
-- Expect ZERO rows. If it returns rows, resolve those duplicates first, because
-- the CREATE UNIQUE INDEX below would otherwise fail.
--   select client_id, tick_type,
--          case tick_type
--            when 'weekly'  then to_char(date_trunc('week',  created_at at time zone 'UTC'), 'YYYY-MM-DD')
--            when 'monthly' then to_char(date_trunc('month', created_at at time zone 'UTC'), 'YYYY-MM-DD')
--            else                to_char(date_trunc('day',   created_at at time zone 'UTC'), 'YYYY-MM-DD')
--          end as period_key,
--          count(*)
--     from public.heartbeat_runs
--    where status in ('claimed','running','succeeded')
--    group by 1, 2, 3
--   having count(*) > 1;
-- ----------------------------------------------------------------------------

-- 1) The stable per-period identity column. Nullable + additive: no default,
--    no NOT NULL, so this cannot break any existing insert path. claimTick
--    always populates it going forward.
alter table public.heartbeat_runs
  add column if not exists period_key text;

-- 2) Backfill any existing rows from tick_type + created_at (no-op on prod).
update public.heartbeat_runs
   set period_key =
         case tick_type
           when 'weekly'  then to_char(date_trunc('week',  created_at at time zone 'UTC'), 'YYYY-MM-DD')
           when 'monthly' then to_char(date_trunc('month', created_at at time zone 'UTC'), 'YYYY-MM-DD')
           else                to_char(date_trunc('day',   created_at at time zone 'UTC'), 'YYYY-MM-DD')
         end
 where period_key is null;

-- 3) The arbiter: at most ONE live/done claim per (client, tick, period).
--    Partial so failed/skipped rows never block a legitimate retry.
create unique index if not exists heartbeat_runs_claim_uniq
  on public.heartbeat_runs (client_id, tick_type, period_key)
  where status in ('claimed', 'running', 'succeeded');

-- ---- POST-VERIFY (read-only; run manually after applying) ------------------
-- (a) The index exists and is UNIQUE + partial:
--   select indexname, indexdef
--     from pg_indexes
--    where schemaname = 'public'
--      and indexname = 'heartbeat_runs_claim_uniq';
-- (b) No live/done row was left with a NULL period_key (would evade the guard):
--   select count(*) from public.heartbeat_runs
--    where period_key is null and status in ('claimed','running','succeeded');
--   -- expect 0
-- ----------------------------------------------------------------------------
