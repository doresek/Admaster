-- ============================================================
-- 049_owner_credit_exempt — permanent credit exemption for owner accounts (Part 3 #6)
-- Additive column + a deduct_credits behavior update (no data destroyed). Idempotent.
--
-- An exempt user is NEVER charged and NEVER limited: deduct_credits returns success
-- without decrementing (logs cost 0 for audit). The app reads {success:true} exactly
-- as before, so no code change is needed. Reverse: set the flag false + restore the
-- original function body (see .down.sql).
--
-- NOTE: the one-off "which user is the owner" UPDATE is applied SEPARATELY (not in this
-- migration — it is environment-specific data, shown to the operator for approval).
-- ============================================================
begin;

alter table public.users
  add column if not exists credits_exempt boolean not null default false;

create or replace function public.deduct_credits(p_user_id uuid, p_action text, p_cost integer)
returns json
language plpgsql
security definer
as $function$
declare
  v_credits int;
  v_exempt  boolean;
begin
  select credits, credits_exempt into v_credits, v_exempt
    from public.users where id = p_user_id for update;

  -- Owner tier: no charge, no limit. Log the action with cost 0 for a complete audit.
  if v_exempt then
    insert into public.credit_history (user_id, action, cost) values (p_user_id, p_action, 0);
    return json_build_object('success', true, 'credits', v_credits, 'exempt', true);
  end if;

  if v_credits < p_cost then
    return json_build_object('success', false, 'error', 'insufficient_credits', 'credits', v_credits);
  end if;

  update public.users set credits = credits - p_cost, updated_at = now() where id = p_user_id;
  insert into public.credit_history (user_id, action, cost) values (p_user_id, p_action, p_cost);
  return json_build_object('success', true, 'credits', v_credits - p_cost);
end;
$function$;

commit;
