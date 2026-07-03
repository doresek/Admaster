-- Reverse of 034_hypotheses. NOTE: restoring the narrow signal_type CHECK is only
-- valid if no rows carry the new values — the guard DELETE is commented out on
-- purpose (destructive); run it manually first if needed.
-- delete from public.learning_signals where signal_type in ('hypothesis_supported','hypothesis_refuted','voc_evidence');
alter table public.learning_signals drop constraint if exists learning_signals_signal_type_check;
alter table public.learning_signals add constraint learning_signals_signal_type_check
  check (signal_type in ('user_worked','user_wrong','performance_win','performance_loss'));
drop table if exists public.hypotheses;
