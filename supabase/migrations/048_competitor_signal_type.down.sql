begin;
alter table public.learning_signals drop constraint if exists learning_signals_signal_type_check;
alter table public.learning_signals add constraint learning_signals_signal_type_check
  check (signal_type in (
    'user_worked','user_wrong','performance_win','performance_loss',
    'hypothesis_supported','hypothesis_refuted','voc_evidence'
  ));
commit;
