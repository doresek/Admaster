-- ============================================================
-- AdMaster Pro — Lock privileged columns on public.users
-- ============================================================
-- ⚠️  MUST BE RUN MANUALLY in Supabase SQL Editor BEFORE deploying
--     the matching application code. Until this migration runs,
--     authenticated users can grant themselves unlimited credits
--     and upgrade their own plan via direct client-side updates.
--
-- Fixes vulnerability B1: addDemoCredits() in credits page allowed
-- any signed-in user to write to users.credits because RLS policy
-- "users_own" permits UPDATE on the user's own row without column
-- restrictions.
--
-- Approach: column-level GRANT revoke + defensive BEFORE UPDATE
-- trigger. SECURITY DEFINER functions (deduct_credits) and the
-- service_role (used by webhooks) retain full access.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Revoke column-level UPDATE for the authenticated role
-- ────────────────────────────────────────────────────────────
-- Postgres GRANTs are additive; revoking UPDATE on specific
-- columns leaves UPDATE on the other columns intact, so users
-- can still edit their name/brand.
revoke update (credits, plan, plan_expires_at, is_agency, owner_id)
  on public.users
  from authenticated;

-- Also block the anon role, in case it ever gets UPDATE granted.
revoke update (credits, plan, plan_expires_at, is_agency, owner_id)
  on public.users
  from anon;

-- ────────────────────────────────────────────────────────────
-- 2. Defense in depth — trigger that rejects unauthorized
--    writes to privileged columns even if grants are later
--    restored by mistake.
-- ────────────────────────────────────────────────────────────
-- SECURITY DEFINER functions execute as their owner (postgres),
-- and the service_role bypasses RLS/grants — both reach this
-- trigger as a non-"authenticated" role, so the check passes.
create or replace function public.block_privileged_user_updates()
returns trigger language plpgsql as $$
begin
  if current_user = 'authenticated' then
    if new.credits         is distinct from old.credits
       or new.plan            is distinct from old.plan
       or new.plan_expires_at is distinct from old.plan_expires_at
       or new.is_agency       is distinct from old.is_agency
       or new.owner_id        is distinct from old.owner_id then
      raise exception 'Privileged columns on public.users cannot be modified by the authenticated role'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists block_privileged_user_updates on public.users;
create trigger block_privileged_user_updates
  before update on public.users
  for each row execute function public.block_privileged_user_updates();
