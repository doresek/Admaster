-- ============================================================
-- 004_briefs_v2.sql
-- Extends `briefs` table to support tokenized multi-step wizard.
-- Preserves all existing data and the legacy `code` flow.
-- Safe to run on a database that already has 001/002/003 applied.
-- ============================================================

-- 1) Add new columns
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

-- 2) Legacy columns become nullable so the new flow can insert rows
--    that exist BEFORE submission (drafts with token only, no code/submission yet)
ALTER TABLE public.briefs ALTER COLUMN code         DROP NOT NULL;
ALTER TABLE public.briefs ALTER COLUMN submitted_at DROP NOT NULL;

-- 3) Expand status enum to support the new wizard states
ALTER TABLE public.briefs DROP CONSTRAINT IF EXISTS briefs_status_check;
ALTER TABLE public.briefs ADD CONSTRAINT briefs_status_check CHECK (
  status IN (
    -- New flow:
    'sent',         -- agency created the link, hasn't been opened yet
    'opened',       -- client opened the link
    'in_progress',  -- client has started filling
    'submitted',    -- client clicked "submit"
    -- Legacy flow (kept for backward compatibility):
    'new',
    'has_avatar',
    'complete'
  )
);

-- 4) Indexes for fast lookup
CREATE UNIQUE INDEX IF NOT EXISTS briefs_token_unique_idx
  ON public.briefs(token) WHERE token IS NOT NULL;

CREATE INDEX IF NOT EXISTS briefs_user_status_idx
  ON public.briefs(user_id, status);

-- 5) Replace the auto-status trigger so it does NOT clobber statuses
--    we explicitly set from the app (sent / opened / in_progress / submitted).
--    Original trigger blindly reset status on every UPDATE based on
--    funnel/avatar — that broke the new flow.
CREATE OR REPLACE FUNCTION public.update_brief_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Only auto-promote status when funnel/avatar transitions FROM null TO a value.
  -- Other cases leave status as set by the application layer.
  IF NEW.funnel IS NOT NULL
     AND (OLD.funnel IS NULL OR OLD.funnel = '')
  THEN
    NEW.status := 'complete';
  ELSIF NEW.avatar IS NOT NULL
        AND (OLD.avatar IS NULL OR OLD.avatar = '')
  THEN
    NEW.status := 'has_avatar';
  END IF;

  -- Always bump updated_at
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Trigger itself is already attached from 001_schema.sql; the CREATE OR REPLACE
-- above is enough to swap the function body.

-- 6) Tiny helper: touch last_saved_at when the client modifies values or step
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

-- 7) RLS — the new flow goes through the service role (admin client),
--    so existing RLS policies are fine. We add ONE small policy so that an
--    agency owner can SELECT their own draft briefs (with token, before submission).
--    The original "briefs_marketer_select" already allows this since it checks
--    user_id = auth.uid(), and that user_id is set when the agency creates the row.

-- Verify by re-creating idempotently (safe no-op if already exists):
DROP POLICY IF EXISTS briefs_marketer_select ON public.briefs;
CREATE POLICY briefs_marketer_select ON public.briefs
  FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- Done. Verify with:
--   SELECT column_name, data_type, is_nullable
--   FROM information_schema.columns
--   WHERE table_name = 'briefs' ORDER BY ordinal_position;
-- ============================================================
