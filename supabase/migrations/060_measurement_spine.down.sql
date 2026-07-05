-- Reverse of 060_measurement_spine. NOTE: restoring the narrower signal_type
-- CHECK is only valid if no 'sales_outcome' rows exist (guard DELETE commented
-- out on purpose — destructive; run manually first if needed).
-- delete from public.learning_signals where signal_type = 'sales_outcome';
alter table public.learning_signals drop constraint if exists learning_signals_signal_type_check;
alter table public.learning_signals add constraint learning_signals_signal_type_check
  check (signal_type in (
    'user_worked','user_wrong','performance_win','performance_loss',
    'hypothesis_supported','hypothesis_refuted','voc_evidence','competitor_evidence'
  ));
drop table if exists public.channel_reconciliation;
drop table if exists public.client_economics;
drop table if exists public.lead_stage_events;
drop table if exists public.lead_touchpoints;
drop table if exists public.funnel_leads;
