-- ============================================================
-- 021_client_core
-- Adds the durable "client core" to meta_clients so analysis + a structured
-- avatar live on the client (source of truth) and every generator reads them
-- via buildAiContext():
--   business_analysis : structured output of analyze_brief, keyed to the client
--   avatar            : structured Avatar v2 profile (JSONB), client-owned
--   core_generated_at : stamp set when the orchestrator last (re)built the core
--
-- Additive + idempotent. Does NOT drop briefs.avatar / brief_analyses (kept for
-- fallback + history). meta_clients already has owner RLS; new columns inherit
-- it, so no new policy is needed and admin/user login is untouched.
--
-- DDL only -- apply MANUALLY in the Supabase SQL Editor (H1).
-- Rollback: 021_client_core.down.sql
-- Run AFTER 020_meta_client_connect_token.sql (and after 018/019).
-- ============================================================

alter table public.meta_clients
  add column if not exists business_analysis jsonb,
  add column if not exists avatar            jsonb,
  add column if not exists core_generated_at timestamptz;

-- GIN index so we can later filter inside the avatar (awareness_level, angle, etc.)
create index if not exists meta_clients_avatar_idx
  on public.meta_clients using gin (avatar);

-- business_analysis shape (mirrors brief_analyses):
--   { "completeness_score": 0, "strengths": [], "gaps": [],
--     "questions": [], "refinements": [], "raw_text": "" }
--
-- avatar shape (Avatar v2 interface; until v2 merges it may transitionally hold
--   { "v1_text": "<tagged text>" }):
--   { "name","age","occupation","location","income_range","family_status",
--     "demographics_summary","psychographics_summary",
--     "pains","desires","fears","status_gains","voice_quotes","daily_routine",
--     "jobs_to_be_done": { "functional","emotional","social","old_hire" },
--     "awareness_level","awareness_strategy","market_sophistication",
--     "recommended_angle","objections","buying_triggers","channels",
--     "recommended_creative_angles" }

-- Verify after apply:
--   select business_analysis, avatar, core_generated_at
--   from public.meta_clients limit 1;
