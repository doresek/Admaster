-- ============================================================
-- 048_competitor_signal_type — add 'competitor_evidence' to learning_signals (bug #5)
-- Widening a CHECK is non-destructive (all existing rows still satisfy it). Idempotent.
-- Closes the type gap noted in lib/competitor-watch/store.ts so competitor findings
-- can emit a learning_signal instead of only writing atoms directly.
-- ============================================================
begin;
alter table public.learning_signals drop constraint if exists learning_signals_signal_type_check;
alter table public.learning_signals add constraint learning_signals_signal_type_check
  check (signal_type in (
    'user_worked','user_wrong','performance_win','performance_loss',
    'hypothesis_supported','hypothesis_refuted','voc_evidence','competitor_evidence'
  ));
commit;
