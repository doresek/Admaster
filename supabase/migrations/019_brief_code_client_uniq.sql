-- ════════════════════════════════════════════════════════════
-- 019_brief_code_client_uniq
-- Record the ONE-CODE-PER-CLIENT rule that already exists on the live DB.
--
-- brief_codes carries a UNIQUE(client_id) constraint named
-- `brief_codes_client_uniq`, so each meta_client has at most one brief code --
-- i.e. one stable magic link. This was added directly on the production
-- database and was never captured in a migration (014 only created a
-- NON-unique index, idx_brief_codes_client_id), so freshly-provisioned
-- environments diverged from prod. This migration makes new DBs match prod and
-- documents the invariant that app/api/briefs/code/issue.ts now relies on
-- (issueBriefCode is idempotent per client because of this constraint).
--
-- NULL client_id may repeat: legacy codes predating 014 have a null client_id,
-- and Postgres treats NULLs as distinct in a UNIQUE constraint, so those rows
-- are unaffected.
--
-- DDL only -- apply MANUALLY in the Supabase SQL Editor. Idempotent and safe to
-- re-run; on production (where the constraint already exists) it is a no-op.
-- ════════════════════════════════════════════════════════════

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brief_codes_client_uniq'
  ) then
    alter table public.brief_codes
      add constraint brief_codes_client_uniq unique (client_id);
  end if;
end $$;

-- Verify with:
--   select conname, contype from pg_constraint
--   where conrelid = 'public.brief_codes'::regclass and conname = 'brief_codes_client_uniq';
