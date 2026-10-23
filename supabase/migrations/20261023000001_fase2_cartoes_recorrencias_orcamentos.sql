-- =====================================================================
-- Meu Financeiro — Fase 2
-- Cartões de crédito (compras, parcelas, faturas, pagamentos, estornos,
-- ajustes), recorrências e orçamentos.
--
-- Migração ADITIVA: nenhuma tabela ou dado da Fase 1 é removido.
-- As únicas mudanças em objetos existentes são:
--   * transactions ganha 3 colunas opcionais (vínculo com recorrência);
--   * account_balances passa a descontar pagamentos de fatura.
--
-- Regras (detalhes em docs/regras-financeiras.md):
--   * Compra parcelada gera N parcelas que somam exatamente o total
--     (centavos de diferença na 1ª parcela).
--   * Parcela k: competência = data da compra + (k-1) meses;
--                fatura    = fatura da compra + (k-1) meses.
--   * Compra no dia do fechamento ou depois entra na fatura seguinte.
--   * Pagamento de fatura reduz o saldo da conta pagadora e a dívida do
--     cartão, mas NÃO é despesa por competência (a despesa são as parcelas).
--   * Dívida do cartão = parcelas lançadas (inclusive futuras) − pagamentos.
--     Limite nunca é dinheiro disponível.
-- =====================================================================

create type public.card_entry_kind      as enum ('purchase', 'refund', 'fee', 'credit');
create type public.recurrence_frequency as enum ('weekly', 'monthly', 'yearly');

-- ---------- Utilitários de data -------------------------------------
create or replace function public.days_in_month(p_date date)
returns int
language sql
immutable
set search_path = ''
as $$
  select extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::int;
$$;

-- Mês (1º dia) da fatura em que cai uma compra feita em p_date.
create or replace function public.card_statement_month(p_date date, p_closing_day int)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_date < make_date(extract(year from p_date)::int, extract(month from p_date)::int,
                            least(p_closing_day, public.days_in_month(p_date)))
      then date_trunc('month', p_date)::date
    else (date_trunc('month', p_date) + interval '1 month')::date
  end;
$$;

-- Datas de fechamento e vencimento da fatura do mês p_month.
-- Vencimento no mesmo mês se o dia de vencimento for depois do fechamento;
-- senão, no mês seguinte.
create or replace function public.card_statement_dates(p_month date, p_closing_day int, p_due_day int,
                                                       out closing_date date, out due_date date)
language sql
immutable
set search_path = ''
as $$
  select
    make_date(extract(year from p_month)::int, extract(month from p_month)::int,
              least(p_closing_day, public.days_in_month(p_month))),
    (select make_date(extract(year from m)::int, extract(month from m)::int,
                      least(p_due_day, public.days_in_month(m)))
       from (select case when p_due_day > p_closing_day then p_month
                         else (p_month + interval '1 month')::date end as m) x);
$$;

create or replace function public.recurrence_date(p_start date, p_frequency public.recurrence_frequency,
                                                  p_interval int, p_k int)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_frequency
    when 'weekly'  then p_start + 7 * p_interval * p_k
    when 'monthly' then (p_start + make_interval(months => p_interval * p_k))::date
    else                (p_start + make_interval(years  => p_interval * p_k))::date
  end;
$$;

-- ---------- Cartões --------------------------------------------------
create table public.credit_cards (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                text not null check (char_length(btrim(name)) between 1 and 60),
  limit_cents         bigint not null default 0 check (limit_cents >= 0 and limit_cents <= 100000000000),
  closing_day         smallint not null check (closing_day between 1 and 31),
  due_day             smallint not null check (due_day between 1 and 31),
  payment_account_id  uuid,
  color               text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon                text not null default 'credit-card' check (char_length(icon) <= 40),
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id),
  foreign key (payment_account_id, user_id) references public.accounts (id, user_id)
    on delete set null (payment_account_id)
);

-- ---------- Faturas --------------------------------------------------
-- As datas ficam gravadas: mudar o dia de fechamento/vencimento do cartão
-- depois não altera faturas antigas.
create table public.credit_card_statements (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id       uuid not null,
  month         date not null check (extract(day from month) = 1),
  closing_date  date not null,
  due_date      date not null check (due_date >= closing_date),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (card_id, month),
  unique (id, user_id),
  foreign key (card_id, user_id) references public.credit_cards (id, user_id) on delete cascade
);
create index credit_card_statements_due_idx on public.credit_card_statements (user_id, due_date);

-- ---------- Recorrências ---------------------------------------------
create table public.recurring_rules (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type             public.category_kind not null,
  description      text not null check (char_length(btrim(description)) between 1 and 120),
  amount_cents     bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  category_id      uuid not null,
  account_id       uuid,
  card_id          uuid,
  payment_method   public.payment_method not null default 'pix',
  frequency        public.recurrence_frequency not null default 'monthly',
  interval_count   smallint not null default 1 check (interval_count between 1 and 12),
  start_date       date not null,
  end_date         date,
  generated_until  date,
  notes            text check (notes is null or char_length(notes) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id)   on delete restrict,
  foreign key (account_id, user_id)  references public.accounts (id, user_id)     on delete restrict,
  foreign key (card_id, user_id)     references public.credit_cards (id, user_id) on delete restrict,
  constraint recurring_one_destination check ((account_id is null) <> (card_id is null)),
  constraint recurring_card_is_expense check (card_id is null or type = 'expense'),
  constraint recurring_dates check (end_date is null or end_date >= start_date)
);

-- Lançamentos gerados por recorrência
alter table public.transactions
  add column recurring_rule_id   uuid,
  add column occurrence_date     date,
  add column recurrence_detached boolean not null default false,
  add constraint transactions_recurring_fk foreign key (recurring_rule_id, user_id)
    references public.recurring_rules (id, user_id) on delete set null (recurring_rule_id),
  add constraint transactions_recurring_occurrence check (recurring_rule_id is null or occurrence_date is not null);
create unique index transactions_recurring_occurrence_uidx
  on public.transactions (recurring_rule_id, occurrence_date) where recurring_rule_id is not null;

-- ---------- Compras, estornos e ajustes no cartão --------------------
create table public.credit_card_purchases (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id            uuid not null,
  kind               public.card_entry_kind not null default 'purchase',
  description        text not null check (char_length(btrim(description)) between 1 and 120),
  total_cents        bigint not null check (total_cents > 0 and total_cents <= 100000000000),
  purchase_date      date not null,
  installments       smallint not null default 1 check (installments between 1 and 72),
  category_id        uuid not null,
  refund_of_id       uuid,
  recurring_rule_id  uuid,
  occurrence_date    date,
  notes              text check (notes is null or char_length(notes) <= 1000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, user_id),
  foreign key (card_id, user_id)      references public.credit_cards (id, user_id)          on delete restrict,
  foreign key (category_id, user_id)  references public.categories (id, user_id)            on delete restrict,
  foreign key (refund_of_id, user_id) references public.credit_card_purchases (id, user_id) on delete cascade,
  foreign key (recurring_rule_id, user_id) references public.recurring_rules (id, user_id)
    on delete set null (recurring_rule_id),
  constraint card_purchase_refund_link check ((kind = 'refund') = (refund_of_id is not null)),
  constraint card_purchase_only_purchase_splits check (kind = 'purchase' or installments = 1),
  constraint card_purchase_min_per_installment check (total_cents >= installments),
  constraint card_purchase_recurring check (recurring_rule_id is null or occurrence_date is not null)
);
create index credit_card_purchases_card_idx on public.credit_card_purchases (card_id, purchase_date);
create index credit_card_purchases_refund_idx on public.credit_card_purchases (refund_of_id) where refund_of_id is not null;
create unique index credit_card_purchases_recurring_uidx
  on public.credit_card_purchases (recurring_rule_id, occurrence_date) where recurring_rule_id is not null;

-- Parcelas: valor COM SINAL (+ cobrança, − crédito/estorno).
create table public.credit_card_installments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  purchase_id      uuid not null,
  card_id          uuid not null,
  statement_id     uuid not null,
  number           smallint not null check (number >= 1),
  total_number     smallint not null check (total_number >= number),
  amount_cents     bigint not null check (amount_cents <> 0),
  competence_date  date not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (purchase_id, number),
  foreign key (purchase_id, user_id)  references public.credit_card_purchases (id, user_id)  on delete cascade,
  foreign key (card_id, user_id)      references public.credit_cards (id, user_id)           on delete cascade,
  foreign key (statement_id, user_id) references public.credit_card_statements (id, user_id) on delete restrict
);
create index credit_card_installments_statement_idx  on public.credit_card_installments (statement_id);
create index credit_card_installments_competence_idx on public.credit_card_installments (user_id, competence_date);
create index credit_card_installments_card_idx       on public.credit_card_installments (card_id);

-- ---------- Pagamentos de fatura -------------------------------------
create table public.statement_payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  statement_id  uuid not null,
  account_id    uuid not null,
  amount_cents  bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  date          date not null,
  notes         text check (notes is null or char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (statement_id, user_id) references public.credit_card_statements (id, user_id) on delete restrict,
  foreign key (account_id, user_id)   references public.accounts (id, user_id)               on delete restrict
);
create index statement_payments_statement_idx on public.statement_payments (statement_id);
create index statement_payments_account_idx   on public.statement_payments (account_id, date);

-- ---------- Orçamentos -----------------------------------------------
create table public.budgets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  month         date not null check (extract(day from month) = 1),
  category_id   uuid not null,
  amount_cents  bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, month, category_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);

-- ---------- Validações -----------------------------------------------
create or replace function public.category_must_be(p_category_id uuid, p_kind public.category_kind)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if (select kind from public.categories where id = p_category_id) is distinct from p_kind then
    raise exception 'Escolha uma categoria de %.', case p_kind when 'income' then 'receita' else 'despesa' end
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.recurring_rules_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.category_must_be(new.category_id, new.type);
  return new;
end;
$$;
create trigger recurring_rules_validate before insert or update on public.recurring_rules
  for each row execute function public.recurring_rules_validate();

create or replace function public.budgets_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.category_must_be(new.category_id, 'expense');
  return new;
end;
$$;
create trigger budgets_validate before insert or update on public.budgets
  for each row execute function public.budgets_validate();

create or replace function public.card_dates_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.closing_day = new.due_day then
    raise exception 'O dia de vencimento deve ser diferente do dia de fechamento.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger credit_cards_validate before insert or update on public.credit_cards
  for each row execute function public.card_dates_validate();

-- ---------- Fatura: busca ou cria -----------------------------------
create or replace function public.ensure_card_statement(p_card_id uuid, p_month date)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id    uuid;
  v_card  public.credit_cards%rowtype;
  v_close date;
  v_due   date;
begin
  select id into v_id from public.credit_card_statements where card_id = p_card_id and month = p_month;
  if found then
    return v_id;
  end if;
  select * into v_card from public.credit_cards where id = p_card_id;
  if not found then
    raise exception 'Cartão não encontrado.' using errcode = 'P0001';
  end if;
  select d.closing_date, d.due_date into v_close, v_due
    from public.card_statement_dates(p_month, v_card.closing_day, v_card.due_day) d;
  insert into public.credit_card_statements (user_id, card_id, month, closing_date, due_date)
  values (v_card.user_id, p_card_id, p_month, v_close, v_due)
  on conflict (card_id, month) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.credit_card_statements where card_id = p_card_id and month = p_month;
  end if;
  return v_id;
end;
$$;

-- ---------- Compra / estorno / ajuste no cartão (atômico) ------------
-- Cria ou edita o lançamento e (re)gera as parcelas.
create or replace function public.save_card_purchase(
  p_id                uuid,
  p_card_id           uuid,
  p_kind              public.card_entry_kind,
  p_description       text,
  p_total_cents       bigint,
  p_purchase_date     date,
  p_installments      int,
  p_category_id       uuid,
  p_refund_of_id      uuid default null,
  p_notes             text default null,
  p_recurring_rule_id uuid default null,
  p_occurrence_date   date default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_card      public.credit_cards%rowtype;
  v_old       public.credit_card_purchases%rowtype;
  v_orig      public.credit_card_purchases%rowtype;
  v_id        uuid;
  v_cat       uuid := p_category_id;
  v_refunded  bigint;
  v_base      bigint;
  v_rest      bigint;
  v_sign      int;
  v_first     date;
  v_stmt      uuid;
  k           int;
begin
  select * into v_card from public.credit_cards where id = p_card_id;
  if not found then
    raise exception 'Cartão não encontrado.' using errcode = 'P0001';
  end if;
  if p_installments is null or p_installments < 1 or p_installments > 72 then
    raise exception 'Número de parcelas inválido (1 a 72).' using errcode = 'P0001';
  end if;
  if p_kind <> 'purchase' and p_installments <> 1 then
    raise exception 'Somente compras podem ser parceladas.' using errcode = 'P0001';
  end if;
  if p_total_cents < p_installments then
    raise exception 'Valor muito baixo para o número de parcelas.' using errcode = 'P0001';
  end if;

  if p_id is not null then
    select * into v_old from public.credit_card_purchases where id = p_id;
    if not found then
      raise exception 'Lançamento do cartão não encontrado.' using errcode = 'P0001';
    end if;
    if v_old.kind <> p_kind then
      raise exception 'Não é possível mudar o tipo do lançamento.' using errcode = 'P0001';
    end if;
  end if;

  if p_kind = 'refund' then
    select * into v_orig from public.credit_card_purchases where id = p_refund_of_id;
    if not found or v_orig.kind <> 'purchase' or v_orig.card_id <> p_card_id then
      raise exception 'O estorno precisa estar ligado a uma compra deste cartão.' using errcode = 'P0001';
    end if;
    v_cat := v_orig.category_id;
    select coalesce(sum(total_cents), 0) into v_refunded
      from public.credit_card_purchases
     where refund_of_id = p_refund_of_id and id is distinct from p_id;
    if v_refunded + p_total_cents > v_orig.total_cents then
      raise exception 'O total estornado não pode ultrapassar o valor da compra.' using errcode = 'P0001';
    end if;
  else
    perform public.category_must_be(v_cat, 'expense');
    if p_refund_of_id is not null then
      raise exception 'Somente estornos se ligam a outra compra.' using errcode = 'P0001';
    end if;
  end if;

  if p_id is not null and p_kind = 'purchase' then
    select coalesce(sum(total_cents), 0) into v_refunded from public.credit_card_purchases where refund_of_id = p_id;
    if v_refunded > p_total_cents then
      raise exception 'Esta compra tem estornos maiores que o novo valor.' using errcode = 'P0001';
    end if;
    if v_refunded > 0 and v_old.card_id <> p_card_id then
      raise exception 'Esta compra tem estornos; não é possível trocar o cartão.' using errcode = 'P0001';
    end if;
  end if;

  if p_id is null then
    insert into public.credit_card_purchases
      (user_id, card_id, kind, description, total_cents, purchase_date, installments, category_id,
       refund_of_id, notes, recurring_rule_id, occurrence_date)
    values
      (v_card.user_id, p_card_id, p_kind, p_description, p_total_cents, p_purchase_date, p_installments, v_cat,
       p_refund_of_id, p_notes, p_recurring_rule_id, p_occurrence_date)
    returning id into v_id;
  else
    update public.credit_card_purchases
       set card_id = p_card_id, description = p_description, total_cents = p_total_cents,
           purchase_date = p_purchase_date, installments = p_installments, category_id = v_cat,
           notes = p_notes,
           recurring_rule_id = coalesce(p_recurring_rule_id, recurring_rule_id),
           occurrence_date   = coalesce(p_occurrence_date, occurrence_date)
     where id = p_id
    returning id into v_id;
    delete from public.credit_card_installments where purchase_id = v_id;
    -- estornos ligados a esta compra continuam válidos; mantém a categoria em sincronia
    update public.credit_card_purchases set category_id = v_cat where refund_of_id = v_id;
  end if;

  v_sign  := case when p_kind in ('purchase', 'fee') then 1 else -1 end;
  v_base  := p_total_cents / p_installments;
  v_rest  := p_total_cents - v_base * p_installments;
  v_first := public.card_statement_month(p_purchase_date, v_card.closing_day);

  for k in 1..p_installments loop
    v_stmt := public.ensure_card_statement(p_card_id, (v_first + make_interval(months => k - 1))::date);
    insert into public.credit_card_installments
      (user_id, purchase_id, card_id, statement_id, number, total_number, amount_cents, competence_date)
    values
      (v_card.user_id, v_id, p_card_id, v_stmt, k, p_installments,
       v_sign * (v_base + case when k = 1 then v_rest else 0 end),
       (p_purchase_date + make_interval(months => k - 1))::date);
  end loop;

  -- remove faturas que ficaram vazias (sem parcelas e sem pagamentos)
  delete from public.credit_card_statements s
   where s.card_id in (p_card_id, coalesce(v_old.card_id, p_card_id))
     and not exists (select 1 from public.credit_card_installments i where i.statement_id = s.id)
     and not exists (select 1 from public.statement_payments sp where sp.statement_id = s.id);

  return v_id;
end;
$$;

-- ---------- Totais por fatura ----------------------------------------
create view public.credit_card_statement_totals
with (security_invoker = true)
as
select
  s.id           as statement_id,
  s.user_id,
  s.card_id,
  s.month,
  s.closing_date,
  s.due_date,
  coalesce((select sum(i.amount_cents) from public.credit_card_installments i
             where i.statement_id = s.id and i.amount_cents > 0), 0)::bigint  as charges_cents,
  coalesce((select -sum(i.amount_cents) from public.credit_card_installments i
             where i.statement_id = s.id and i.amount_cents < 0), 0)::bigint  as credits_cents,
  coalesce((select sum(p.amount_cents) from public.statement_payments p
             where p.statement_id = s.id), 0)::bigint                         as payments_cents
from public.credit_card_statements s;

-- ---------- Dívida de cada cartão em uma data ------------------------
-- = parcelas de compras feitas até a data (inclusive parcelas futuras)
--   − pagamentos até a data. Negativo = crédito a favor.
create or replace function public.card_balances(p_as_of date default current_date)
returns table (card_id uuid, used_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    (coalesce((select sum(i.amount_cents)
                 from public.credit_card_installments i
                 join public.credit_card_purchases p on p.id = i.purchase_id
                where i.card_id = c.id and p.purchase_date <= p_as_of), 0)
     - coalesce((select sum(sp.amount_cents)
                   from public.statement_payments sp
                   join public.credit_card_statements s on s.id = sp.statement_id
                  where s.card_id = c.id and sp.date <= p_as_of), 0))::bigint
  from public.credit_cards c;
$$;

-- ---------- Saldos das contas: agora descontam pagamentos de fatura ---
create or replace function public.account_balances(p_as_of date default current_date)
returns table (account_id uuid, balance_cents bigint, reserved_cents bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    a.id,
    a.initial_balance_cents + coalesce(mv.total, 0)::bigint,
    coalesce(rs.total, 0)::bigint
  from public.accounts a
  left join lateral (
    select sum(x.delta) as total from (
      select case t.type when 'expense' then -t.amount_cents else t.amount_cents end as delta
        from public.transactions t
       where t.account_id = a.id and t.status = 'paid'
         and t.paid_at >= a.initial_balance_date and t.paid_at <= p_as_of
      union all
      select -tr.amount_cents
        from public.transfers tr
       where tr.from_account_id = a.id and tr.status = 'paid'
         and tr.paid_at >= a.initial_balance_date and tr.paid_at <= p_as_of
      union all
      select tr.amount_cents
        from public.transfers tr
       where tr.to_account_id = a.id and tr.status = 'paid'
         and tr.paid_at >= a.initial_balance_date and tr.paid_at <= p_as_of
      union all
      select adj.amount_cents
        from public.account_adjustments adj
       where adj.account_id = a.id and adj.date >= a.initial_balance_date and adj.date <= p_as_of
      union all
      select -sp.amount_cents
        from public.statement_payments sp
       where sp.account_id = a.id and sp.date >= a.initial_balance_date and sp.date <= p_as_of
    ) x
  ) mv on true
  left join lateral (
    select sum(case s.kind when 'deposit' then s.amount_cents else -s.amount_cents end) as total
      from public.savings_movements s
     where s.account_id = a.id and s.date <= p_as_of
  ) rs on true
  where a.initial_balance_date <= p_as_of;
$$;

-- ---------- Recorrências: geração idempotente ------------------------
-- Gera ocorrências previstas até p_until (cartão: só até p_today, pois
-- uma cobrança futura no cartão ainda não existe). Nunca marca como pago.
-- generated_until funciona como "marca d'água": uma ocorrência excluída
-- pelo usuário não volta a ser criada. O índice único impede duplicatas.
create or replace function public.generate_recurring(p_today date, p_until date)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r       public.recurring_rules%rowtype;
  v_from  date;
  v_to    date;
  d       date;
  k       int;
  n       int := 0;
begin
  -- serializa gerações concorrentes do mesmo usuário (ex.: duas abas abertas)
  perform pg_advisory_xact_lock(hashtext('generate_recurring:' || coalesce(auth.uid()::text, 'service')));

  for r in select * from public.recurring_rules order by created_at loop
    v_to := case when r.card_id is not null then least(p_until, p_today) else p_until end;
    if r.end_date is not null then
      v_to := least(v_to, r.end_date);
    end if;
    v_from := coalesce(r.generated_until + 1, r.start_date);
    continue when v_to < v_from;

    k := 0;
    loop
      d := public.recurrence_date(r.start_date, r.frequency, r.interval_count, k);
      exit when d > v_to or k > 5000;
      if d >= v_from then
        if r.account_id is not null then
          insert into public.transactions
            (user_id, type, description, amount_cents, date, status, paid_at, account_id, category_id,
             payment_method, notes, recurring_rule_id, occurrence_date)
          values
            (r.user_id, r.type::text::public.transaction_type, r.description, r.amount_cents, d, 'pending', null,
             r.account_id, r.category_id, r.payment_method, r.notes, r.id, d)
          on conflict (recurring_rule_id, occurrence_date) where recurring_rule_id is not null do nothing;
          if found then n := n + 1; end if;
        elsif not exists (select 1 from public.credit_card_purchases
                           where recurring_rule_id = r.id and occurrence_date = d) then
          perform public.save_card_purchase(null, r.card_id, 'purchase', r.description, r.amount_cents, d, 1,
                                            r.category_id, null, r.notes, r.id, d);
          n := n + 1;
        end if;
      end if;
      k := k + 1;
    end loop;

    update public.recurring_rules
       set generated_until = v_to
     where id = r.id and (generated_until is null or generated_until < v_to);
  end loop;
  return n;
end;
$$;

-- Encerra a série a partir de p_from (inclusive): remove ocorrências
-- previstas (não pagas e não editadas individualmente) dali em diante.
create or replace function public.end_recurring_rule(p_rule_id uuid, p_from date)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.recurring_rules%rowtype;
begin
  select * into r from public.recurring_rules where id = p_rule_id;
  if not found then
    raise exception 'Recorrência não encontrada.' using errcode = 'P0001';
  end if;
  delete from public.transactions
   where recurring_rule_id = r.id and occurrence_date >= p_from
     and status = 'pending' and not recurrence_detached;
  delete from public.credit_card_purchases
   where recurring_rule_id = r.id and occurrence_date >= p_from;
  if p_from <= r.start_date then
    delete from public.recurring_rules where id = r.id;
  else
    update public.recurring_rules
       set end_date = p_from - 1,
           generated_until = least(coalesce(generated_until, p_from - 1), p_from - 1)
     where id = r.id;
  end if;
end;
$$;

-- "Editar esta e as próximas": encerra a série antiga em p_from e cria uma
-- nova com os novos dados a partir de p_new_start. A ocorrência editada
-- (p_transaction_id ou p_purchase_id) é religada à nova série para não
-- ser duplicada. Retorna o id da nova recorrência.
create or replace function public.split_recurring_rule(
  p_rule_id         uuid,
  p_from            date,
  p_new_start       date,
  p_description     text,
  p_amount_cents    bigint,
  p_category_id     uuid,
  p_account_id      uuid,
  p_card_id         uuid,
  p_payment_method  public.payment_method,
  p_frequency       public.recurrence_frequency,
  p_interval        int,
  p_end_date        date,
  p_notes           text,
  p_transaction_id  uuid default null,
  p_purchase_id     uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r      public.recurring_rules%rowtype;
  v_new  uuid;
begin
  select * into r from public.recurring_rules where id = p_rule_id;
  if not found then
    raise exception 'Recorrência não encontrada.' using errcode = 'P0001';
  end if;

  insert into public.recurring_rules
    (user_id, type, description, amount_cents, category_id, account_id, card_id, payment_method,
     frequency, interval_count, start_date, end_date, notes)
  values
    (r.user_id, r.type, p_description, p_amount_cents, p_category_id, p_account_id, p_card_id, p_payment_method,
     p_frequency, p_interval, p_new_start, p_end_date, p_notes)
  returning id into v_new;

  -- a ocorrência editada passa para a nova série, com os novos dados
  if p_transaction_id is not null then
    if p_account_id is null then
      raise exception 'Para mover a série para o cartão, encerre-a e crie uma nova.' using errcode = 'P0001';
    end if;
    update public.transactions
       set recurring_rule_id = v_new, occurrence_date = p_new_start, date = p_new_start,
           description = p_description, amount_cents = p_amount_cents, category_id = p_category_id,
           account_id = p_account_id, payment_method = p_payment_method, notes = p_notes,
           recurrence_detached = false
     where id = p_transaction_id and recurring_rule_id = r.id;
  end if;
  if p_purchase_id is not null then
    if p_card_id is null then
      raise exception 'Para mover a série para uma conta, encerre-a e crie uma nova.' using errcode = 'P0001';
    end if;
    update public.credit_card_purchases
       set recurring_rule_id = v_new, occurrence_date = p_new_start
     where id = p_purchase_id and recurring_rule_id = r.id;
    perform public.save_card_purchase(p_purchase_id, p_card_id, 'purchase', p_description, p_amount_cents,
                                      p_new_start, 1, p_category_id, null, p_notes, v_new, p_new_start);
  end if;

  perform public.end_recurring_rule(r.id, p_from);
  return v_new;
end;
$$;

-- ---------- Orçamentos: copiar para outro mês ------------------------
create or replace function public.copy_budgets(p_from date, p_to date)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.budgets (user_id, month, category_id, amount_cents)
  select b.user_id, date_trunc('month', p_to)::date, b.category_id, b.amount_cents
    from public.budgets b
    join public.categories c on c.id = b.category_id and c.archived_at is null
   where b.month = date_trunc('month', p_from)::date
  on conflict (user_id, month, category_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------- updated_at ----------------------------------------------
create trigger credit_cards_updated_at             before update on public.credit_cards             for each row execute function public.set_updated_at();
create trigger credit_card_statements_updated_at   before update on public.credit_card_statements   for each row execute function public.set_updated_at();
create trigger credit_card_purchases_updated_at    before update on public.credit_card_purchases    for each row execute function public.set_updated_at();
create trigger credit_card_installments_updated_at before update on public.credit_card_installments for each row execute function public.set_updated_at();
create trigger statement_payments_updated_at       before update on public.statement_payments       for each row execute function public.set_updated_at();
create trigger recurring_rules_updated_at          before update on public.recurring_rules          for each row execute function public.set_updated_at();
create trigger budgets_updated_at                  before update on public.budgets                  for each row execute function public.set_updated_at();

-- ---------- Row Level Security --------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['credit_cards','credit_card_statements','credit_card_purchases',
                           'credit_card_installments','statement_payments','recurring_rules','budgets']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format($p$create policy %I on public.%I for all to authenticated
                     using (user_id = (select auth.uid()))
                     with check (user_id = (select auth.uid()))$p$, t || '_owner', t);
  end loop;
end;
$$;

revoke all on public.credit_card_statement_totals from anon;
grant select on public.credit_card_statement_totals to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.days_in_month(date)',
    'public.card_statement_month(date, int)',
    'public.card_statement_dates(date, int, int)',
    'public.recurrence_date(date, public.recurrence_frequency, int, int)',
    'public.category_must_be(uuid, public.category_kind)',
    'public.ensure_card_statement(uuid, date)',
    'public.save_card_purchase(uuid, uuid, public.card_entry_kind, text, bigint, date, int, uuid, uuid, text, uuid, date)',
    'public.card_balances(date)',
    'public.generate_recurring(date, date)',
    'public.end_recurring_rule(uuid, date)',
    'public.split_recurring_rule(uuid, date, date, text, bigint, uuid, uuid, uuid, public.payment_method, public.recurrence_frequency, int, date, text, uuid, uuid)',
    'public.copy_budgets(date, date)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end;
$$;

-- account_balances foi recriada: mantém as permissões da Fase 1
revoke execute on function public.account_balances(date) from public, anon;
grant  execute on function public.account_balances(date) to authenticated, service_role;
