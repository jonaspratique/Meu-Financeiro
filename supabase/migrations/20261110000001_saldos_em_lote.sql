-- Saldos de várias datas numa chamada só (gráficos do início e relatórios).
-- Antes: uma chamada por mês (≈14 idas ao banco por página).
create or replace function public.account_balances_at(p_dates date[])
returns table (as_of date, account_id uuid, balance_cents bigint, reserved_cents bigint)
language sql stable security invoker set search_path = public as $$
  select d.as_of, b.account_id, b.balance_cents, b.reserved_cents
  from unnest(p_dates) as d(as_of)
  cross join lateral public.account_balances(d.as_of) b;
$$;

create or replace function public.card_balances_at(p_dates date[])
returns table (as_of date, card_id uuid, used_cents bigint)
language sql stable security invoker set search_path = public as $$
  select d.as_of, b.card_id, b.used_cents
  from unnest(p_dates) as d(as_of)
  cross join lateral public.card_balances(d.as_of) b;
$$;

revoke all on function public.account_balances_at(date[]) from public, anon;
revoke all on function public.card_balances_at(date[]) from public, anon;
grant execute on function public.account_balances_at(date[]) to authenticated;
grant execute on function public.card_balances_at(date[]) to authenticated;
