-- ============================================================
-- 010: Backfill the function/trigger tail of 005_phase_c.sql that
-- was never applied to production (migration-numbering drift).
-- (Renumbered from 009 to avoid colliding with the parallel session's
--  009_harden_definer_search_path.sql.)
--
-- Adds to prod (confirmed missing via pg_proc/pg_trigger audit):
--   - public.unread_notif_count(uuid)        → sidebar bell unread count
--   - public.handle_new_user_settings()      → trigger fn
--   - trigger on_user_created_settings       → auto-creates user_settings
-- ...and backfills user_settings for existing users.
--
-- NOTE: an earlier draft used `on conflict (user_id) do nothing`, which
-- errors when user_settings has no unique constraint on user_id and rolled
-- back the whole transaction (so nothing applied). This version uses
-- `where not exists` instead — constraint-independent and idempotent.
--
-- search_path is pinned on both SECURITY DEFINER functions
-- (function_search_path_mutable hardening, matching 009_harden).
-- Idempotent — safe to run on prod as-is.
-- ============================================================

-- RPC: unread notification count (used by sidebar bell).
-- security definer + a caller-identity guard: the param is kept for
-- call-signature compatibility (app passes p_user_id: user.id), but a
-- direct caller cannot read another user's count (IDOR).
create or replace function public.unread_notif_count(p_user_id uuid)
returns int
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;
  return (select count(*)::int from public.notifications
          where user_id = p_user_id and read = false);
end;
$$;

grant execute on function public.unread_notif_count(uuid) to authenticated;

-- Auto-create user_settings row when a user is created
create or replace function public.handle_new_user_settings()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_settings (user_id)
    select new.id
    where not exists (select 1 from public.user_settings where user_id = new.id);
  return new;
end;
$$;

drop trigger if exists on_user_created_settings on public.users;
create trigger on_user_created_settings
  after insert on public.users
  for each row execute function public.handle_new_user_settings();

-- Backfill existing users (constraint-independent; no-op for rows that exist)
insert into public.user_settings (user_id)
  select u.id from public.users u
  where not exists (select 1 from public.user_settings us where us.user_id = u.id);
