-- ============================================================
-- 013_briefs_v2.sql
-- Restores the tokenized multi-step brief wizard ("Briefs v2").
-- Extends the existing `briefs` table; preserves the legacy `code` flow.
-- Idempotent + safe to run on a DB that already has 001..012 applied.
-- (Re-introduces the old 004_briefs_v2.sql that was dropped during rebaseline.)
-- ============================================================

-- 1) New columns for the tokenized per-client flow
ALTER TABLE public.briefs
  ADD COLUMN IF NOT EXISTS token         text,
  ADD COLUMN IF NOT EXISTS client_name   text,
  ADD COLUMN IF NOT EXISTS client_email  text,
  ADD COLUMN IF NOT EXISTS client_phone  text,
  ADD COLUMN IF NOT EXISTS current_step  int  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS progress_pct  int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS template_key  text NOT NULL DEFAULT 'universal',
  ADD COLUMN IF NOT EXISTS opened_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at    timestamptz;

-- 2) Legacy columns become nullable so a brief can exist BEFORE submission
--    (a draft that has a token only, with no code / no submission yet).
ALTER TABLE public.briefs ALTER COLUMN code         DROP NOT NULL;
ALTER TABLE public.briefs ALTER COLUMN submitted_at DROP NOT NULL;

-- 3) Expand the status enum to the new wizard states (keeps legacy states)
ALTER TABLE public.briefs DROP CONSTRAINT IF EXISTS briefs_status_check;
ALTER TABLE public.briefs ADD CONSTRAINT briefs_status_check CHECK (
  status IN (
    'sent',         -- link created, not opened yet
    'opened',       -- client opened the link
    'in_progress',  -- client started filling
    'submitted',    -- client submitted
    'new',          -- legacy
    'has_avatar',   -- legacy
    'complete'      -- legacy
  )
);

-- 4) Indexes
CREATE UNIQUE INDEX IF NOT EXISTS briefs_token_unique_idx
  ON public.briefs(token) WHERE token IS NOT NULL;
CREATE INDEX IF NOT EXISTS briefs_user_status_idx
  ON public.briefs(user_id, status);

-- 5) Auto-status trigger must NOT clobber statuses set by the app
--    (sent / opened / in_progress / submitted). Only auto-promote on
--    funnel/avatar transitions FROM null TO a value.
CREATE OR REPLACE FUNCTION public.update_brief_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.funnel IS NOT NULL
     AND (OLD.funnel IS NULL OR OLD.funnel = '')
  THEN
    NEW.status := 'complete';
  ELSIF NEW.avatar IS NOT NULL
        AND (OLD.avatar IS NULL OR OLD.avatar = '')
  THEN
    NEW.status := 'has_avatar';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- 6) Touch last_saved_at when the client edits values / step / status
CREATE OR REPLACE FUNCTION public.touch_brief_last_saved()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.values       IS DISTINCT FROM NEW.values
     OR OLD.current_step IS DISTINCT FROM NEW.current_step
     OR OLD.status    IS DISTINCT FROM NEW.status
  THEN
    NEW.last_saved_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS brief_last_saved_trigger ON public.briefs;
CREATE TRIGGER brief_last_saved_trigger
  BEFORE UPDATE ON public.briefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_brief_last_saved();

-- 7) RLS — the public flow uses the service role (admin client), so existing
--    policies suffice. Re-assert the agency-owner SELECT policy idempotently.
DROP POLICY IF EXISTS briefs_marketer_select ON public.briefs;
CREATE POLICY briefs_marketer_select ON public.briefs
  FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- Verify:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'briefs' ORDER BY ordinal_position;
-- ============================================================
