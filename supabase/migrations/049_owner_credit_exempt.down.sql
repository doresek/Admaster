-- Reverse 049: restore the original deduct_credits, drop the exemption column.
begin;
create or replace function public.deduct_credits(p_user_id uuid, p_action text, p_cost integer)
returns json language plpgsql security definer as $function$
declare v_credits int;
begin
  select credits into v_credits from public.users where id = p_user_id for update;
  if v_credits < p_cost then
    return json_build_object('success', false, 'error', 'insufficient_credits', 'credits', v_credits);
  end if;
  update public.users set credits = credits - p_cost, updated_at = now() where id = p_user_id;
  insert into public.credit_history (user_id, action, cost) values (p_user_id, p_action, p_cost);
  return json_build_object('success', true, 'credits', v_credits - p_cost);
end; $function$;
alter table public.users drop column if exists credits_exempt;
commit;
