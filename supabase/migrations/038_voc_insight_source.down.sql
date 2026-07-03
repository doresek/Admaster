-- Reverse of 038_voc_insight_source. Reclassify voc atoms back to user_signal
-- (source_ref.voc keeps identifying them), then restore the narrow CHECK.
update public.client_insights set source = 'user_signal' where source = 'voc';
alter table public.client_insights drop constraint if exists client_insights_source_check;
alter table public.client_insights add constraint client_insights_source_check
  check (source in ('brief','user_signal','content_performance','ai_synthesis'));
