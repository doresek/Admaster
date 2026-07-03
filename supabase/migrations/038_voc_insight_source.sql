-- ============================================================
-- 038_voc_insight_source — dedicated 'voc' provenance for VoC-created atoms
-- (follow-up logged in C-08's build: InsightSource had no 'voc' value, so
-- VoC atoms shipped as source='user_signal' + source_ref.voc — honest but
-- second-class provenance for a first-class input pipeline).
-- ADDITIVE (CHECK widened, never narrowed). Reverse: 038_voc_insight_source.down.sql
-- ============================================================

alter table public.client_insights drop constraint if exists client_insights_source_check;
alter table public.client_insights add constraint client_insights_source_check
  check (source in ('brief','user_signal','content_performance','ai_synthesis','voc'));

-- Reclassify the atoms C-08 already tagged via source_ref (idempotent; no-op
-- when none exist yet — prod has zero VoC atoms at authoring time).
update public.client_insights
   set source = 'voc'
 where source = 'user_signal'
   and (source_ref ->> 'voc') = 'true';
