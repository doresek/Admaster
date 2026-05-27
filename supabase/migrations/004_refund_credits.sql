-- Refund credits when an external provider call fails (Ideogram, DALL-E, etc.)
-- Logs as `<action>:refund` with negative cost so credit_history is auditable.

create or replace function public.refund_credits(
  p_user_id uuid,
  p_action  text,
  p_cost    int
)
returns json language plpgsql security definer as $$
declare
  v_credits int;
begin
  update public.users
    set credits = credits + p_cost, updated_at = now()
    where id = p_user_id
    returning credits into v_credits;

  insert into public.credit_history (user_id, action, cost)
  values (p_user_id, p_action || ':refund', -p_cost);

  return json_build_object('success', true, 'credits', v_credits);
end;
$$;

revoke all on function public.refund_credits(uuid, text, int) from public, anon;
grant execute on function public.refund_credits(uuid, text, int) to authenticated, service_role;
