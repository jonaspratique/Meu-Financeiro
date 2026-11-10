-- Reserva ligada a uma conta (onde o dinheiro está guardado) e criação com
-- valor já guardado, numa operação só.
alter table public.savings_goals add column account_id uuid;
alter table public.savings_goals
  add constraint savings_goals_account_fk foreign key (account_id, user_id)
  references public.accounts (id, user_id) on delete set null (account_id);
create index savings_goals_account_idx on public.savings_goals (account_id);

-- p_saved_mode:
--   'add'        o valor está guardado à parte (caixinha, CDB…) e ainda não
--                aparece no saldo da conta → soma ao saldo (ajuste) e reserva
--   'in_balance' o valor já faz parte do saldo da conta → só reserva
create or replace function public.save_goal(
  p_id uuid, p_name text, p_kind public.savings_goal_kind, p_target_cents bigint,
  p_target_date date, p_color text, p_icon text, p_account_id uuid,
  p_saved_cents bigint default 0, p_saved_mode text default 'add'
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_id   uuid;
  v_day  date;
  v_bal  bigint;
begin
  if p_id is null then
    insert into public.savings_goals (name, kind, target_cents, target_date, color, icon, account_id)
    values (p_name, p_kind, p_target_cents, p_target_date, p_color, p_icon, p_account_id)
    returning id into v_id;
  else
    update public.savings_goals
       set name = p_name, kind = p_kind, target_cents = p_target_cents, target_date = p_target_date,
           color = p_color, icon = p_icon, account_id = p_account_id
     where id = p_id
    returning id into v_id;
    if v_id is null then raise exception 'Reserva não encontrada.' using errcode = 'P0001'; end if;
  end if;

  if coalesce(p_saved_cents, 0) > 0 then
    if p_account_id is null then
      raise exception 'Escolha a conta onde o dinheiro da reserva está guardado.' using errcode = 'P0001';
    end if;
    select greatest(current_date, a.initial_balance_date) into v_day from public.accounts a where a.id = p_account_id;
    if p_saved_mode = 'add' then
      select b.balance_cents into v_bal from public.account_balances(v_day) b where b.account_id = p_account_id;
      insert into public.account_adjustments (account_id, date, amount_cents, reason, system_balance_cents, reported_balance_cents)
      values (p_account_id, v_day, p_saved_cents, 'Reserva "' || p_name || '" guardada na conta',
              coalesce(v_bal, 0), coalesce(v_bal, 0) + p_saved_cents);
    end if;
    insert into public.savings_movements (goal_id, account_id, kind, amount_cents, date, notes)
    values (v_id, p_account_id, 'deposit', p_saved_cents, v_day, 'Valor já guardado ao criar a reserva');
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_goal(uuid, text, public.savings_goal_kind, bigint, date, text, text, uuid, bigint, text) from public, anon;
grant execute on function public.save_goal(uuid, text, public.savings_goal_kind, bigint, date, text, text, uuid, bigint, text) to authenticated;
