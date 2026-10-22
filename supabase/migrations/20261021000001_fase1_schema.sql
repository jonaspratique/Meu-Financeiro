-- =====================================================================
-- Meu Financeiro — Fase 1 (MVP)
-- Contas, categorias, lançamentos, transferências, ajustes de saldo,
-- reservas financeiras. Valores monetários sempre em CENTAVOS (bigint).
--
-- Princípios:
--   * Saldo nunca é armazenado: é sempre derivado (função account_balances).
--   * Toda linha pertence a um usuário (user_id) e é protegida por RLS.
--   * FKs compostas (id, user_id) impedem referenciar dados de outro usuário.
-- =====================================================================

-- ---------- Tipos ----------------------------------------------------
create type public.account_type          as enum ('checking', 'digital', 'cash', 'savings', 'investment');
create type public.category_kind         as enum ('income', 'expense');
create type public.transaction_type      as enum ('income', 'expense', 'refund');
create type public.entry_status          as enum ('pending', 'paid', 'cancelled');
create type public.payment_method        as enum ('pix', 'debit', 'cash', 'boleto', 'bank_transfer', 'auto_debit', 'other');
create type public.savings_goal_kind     as enum ('emergency', 'travel', 'car', 'investments', 'projects', 'other');
create type public.savings_movement_kind as enum ('deposit', 'withdrawal');

-- ---------- Utilitário: updated_at ----------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- Contas ---------------------------------------------------
create table public.accounts (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                   text not null check (char_length(btrim(name)) between 1 and 60),
  type                   public.account_type not null,
  -- Contas operacionais compõem o "saldo disponível". Poupança/investimento
  -- normalmente não (mas o usuário pode mudar).
  is_operational         boolean not null default true,
  initial_balance_cents  bigint not null default 0,
  initial_balance_date   date not null,
  color                  text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon                   text not null default 'wallet' check (char_length(icon) <= 40),
  is_default             boolean not null default false,
  archived_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)
);
create unique index accounts_one_default_per_user on public.accounts (user_id) where is_default;

-- ---------- Categorias ----------------------------------------------
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  kind        public.category_kind not null,
  color       text not null default '#64748b' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon        text not null default 'tag' check (char_length(icon) <= 40),
  is_fixed    boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, kind, name),
  unique (id, user_id)
);

-- ---------- Lançamentos (receitas, despesas, estornos) ---------------
-- date    = data de competência (quando o fato aconteceu / vence)
-- paid_at = data de caixa (quando o dinheiro efetivamente entrou/saiu)
create table public.transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type            public.transaction_type not null,
  description     text not null check (char_length(btrim(description)) between 1 and 120),
  amount_cents    bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  date            date not null,
  status          public.entry_status not null default 'paid',
  paid_at         date,
  account_id      uuid not null,
  category_id     uuid,
  payment_method  public.payment_method not null default 'pix',
  notes           text check (notes is null or char_length(notes) <= 1000),
  refund_of_id    uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id)   references public.accounts (id, user_id)     on delete restrict,
  foreign key (category_id, user_id)  references public.categories (id, user_id)   on delete restrict,
  foreign key (refund_of_id, user_id) references public.transactions (id, user_id) on delete restrict,
  constraint transactions_paid_consistency   check ((status = 'paid') = (paid_at is not null)),
  constraint transactions_refund_link        check ((type = 'refund') = (refund_of_id is not null)),
  constraint transactions_category_required  check (category_id is not null)
);
create index transactions_user_date_idx    on public.transactions (user_id, date);
create index transactions_user_paid_at_idx on public.transactions (user_id, paid_at);
create index transactions_account_idx      on public.transactions (account_id);
create index transactions_category_idx     on public.transactions (category_id);
create index transactions_refund_of_idx    on public.transactions (refund_of_id) where refund_of_id is not null;

-- Regras que dependem de outras linhas:
--   * categoria precisa ser do mesmo tipo (receita/despesa);
--   * estorno só de despesa, herda a categoria, e a soma dos estornos
--     ativos não pode passar do valor original;
--   * despesa com estornos ativos não pode ter o valor reduzido abaixo
--     do total estornado nem ser cancelada.
create or replace function public.transactions_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_cat_kind     public.category_kind;
  v_orig         public.transactions%rowtype;
  v_refunded     bigint;
begin
  if new.type = 'refund' then
    select * into v_orig from public.transactions where id = new.refund_of_id;
    if v_orig.type <> 'expense' then
      raise exception 'Só é possível estornar despesas.' using errcode = 'P0001';
    end if;
    new.category_id := v_orig.category_id;
    if new.status <> 'cancelled' then
      select coalesce(sum(amount_cents), 0) into v_refunded
        from public.transactions
       where refund_of_id = new.refund_of_id and status <> 'cancelled' and id <> new.id;
      if v_refunded + new.amount_cents > v_orig.amount_cents then
        raise exception 'O total estornado não pode ultrapassar o valor da despesa original.' using errcode = 'P0001';
      end if;
    end if;
  else
    select kind into v_cat_kind from public.categories where id = new.category_id;
    if v_cat_kind::text <> new.type::text then
      raise exception 'A categoria escolhida não é do tipo %.',
        case new.type when 'income' then 'receita' else 'despesa' end using errcode = 'P0001';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.type = 'expense' then
    select coalesce(sum(amount_cents), 0) into v_refunded
      from public.transactions
     where refund_of_id = old.id and status <> 'cancelled';
    if v_refunded > 0 and (new.type <> 'expense' or new.status = 'cancelled' or new.amount_cents < v_refunded) then
      raise exception 'Esta despesa possui estornos. Remova ou cancele os estornos antes.' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create trigger transactions_validate
  before insert or update on public.transactions
  for each row execute function public.transactions_validate();

-- ---------- Transferências internas ---------------------------------
create table public.transfers (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_account_id  uuid not null,
  to_account_id    uuid not null,
  amount_cents     bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  date             date not null,
  status           public.entry_status not null default 'paid',
  paid_at          date,
  description      text not null default 'Transferência' check (char_length(btrim(description)) between 1 and 120),
  notes            text check (notes is null or char_length(notes) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (from_account_id, user_id) references public.accounts (id, user_id) on delete restrict,
  foreign key (to_account_id, user_id)   references public.accounts (id, user_id) on delete restrict,
  constraint transfers_distinct_accounts check (from_account_id <> to_account_id),
  constraint transfers_paid_consistency  check ((status = 'paid') = (paid_at is not null))
);
create index transfers_user_date_idx on public.transfers (user_id, date);
create index transfers_from_idx      on public.transfers (from_account_id);
create index transfers_to_idx        on public.transfers (to_account_id);

-- ---------- Ajustes de saldo (conciliação) --------------------------
create table public.account_adjustments (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null default auth.uid() references auth.users (id) on delete cascade,
  account_id              uuid not null,
  date                    date not null,
  amount_cents            bigint not null check (amount_cents <> 0),
  reason                  text not null check (char_length(btrim(reason)) between 3 and 300),
  -- fotografia do momento da conciliação, para auditoria
  system_balance_cents    bigint not null,
  reported_balance_cents  bigint not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade,
  constraint adjustments_consistency check (reported_balance_cents - system_balance_cents = amount_cents)
);
create index account_adjustments_account_idx on public.account_adjustments (account_id, date);

-- ---------- Reservas -------------------------------------------------
create table public.savings_goals (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  kind          public.savings_goal_kind not null default 'other',
  target_cents  bigint not null check (target_cents > 0 and target_cents <= 100000000000),
  target_date   date,
  color         text not null default '#10b981' check (color ~ '^#[0-9a-fA-F]{6}$'),
  icon          text not null default 'piggy-bank' check (char_length(icon) <= 40),
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, name),
  unique (id, user_id)
);

-- Um aporte NÃO cria dinheiro: ele etiqueta (aloca) parte do saldo de uma
-- conta existente para a reserva. Retirada desfaz a alocação.
create table public.savings_movements (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  goal_id       uuid not null,
  account_id    uuid not null,
  kind          public.savings_movement_kind not null,
  amount_cents  bigint not null check (amount_cents > 0 and amount_cents <= 100000000000),
  date          date not null,
  notes         text check (notes is null or char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (goal_id, user_id)    references public.savings_goals (id, user_id) on delete cascade,
  foreign key (account_id, user_id) references public.accounts (id, user_id)      on delete restrict
);
create index savings_movements_goal_idx    on public.savings_movements (goal_id, date);
create index savings_movements_account_idx on public.savings_movements (account_id);

-- ---------- Função única de saldos ----------------------------------
-- Saldo da conta em p_as_of = saldo inicial
--   + receitas e estornos efetivados  - despesas efetivadas
--   + transferências recebidas        - transferências enviadas
--   + ajustes de conciliação
-- considerando apenas o que foi efetivado (paid) entre a data do saldo
-- inicial e p_as_of. Pendentes e cancelados nunca alteram o saldo.
-- reserved_cents = quanto do saldo está etiquetado para reservas.
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
    ) x
  ) mv on true
  left join lateral (
    select sum(case s.kind when 'deposit' then s.amount_cents else -s.amount_cents end) as total
      from public.savings_movements s
     where s.account_id = a.id and s.date <= p_as_of
  ) rs on true
  where a.initial_balance_date <= p_as_of;
$$;

-- ---------- Regras de reservas --------------------------------------
-- 1) Aporte não pode exceder o saldo livre (não reservado) da conta hoje.
-- 2) O saldo de uma reserva em uma conta nunca fica negativo.
create or replace function public.savings_movements_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_free     bigint;
  v_goal_net bigint;
  v_prev     bigint := 0;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    if new.kind = 'deposit' then
      select b.balance_cents - b.reserved_cents into v_free
        from public.account_balances(greatest(current_date, new.date)) b
       where b.account_id = new.account_id;
      -- se for edição de um aporte existente na mesma conta, devolve o valor antigo
      if tg_op = 'UPDATE' and old.kind = 'deposit' and old.account_id = new.account_id then
        v_prev := old.amount_cents;
      elsif tg_op = 'UPDATE' and old.kind = 'withdrawal' and old.account_id = new.account_id then
        v_prev := -old.amount_cents;
      end if;
      if coalesce(v_free, 0) + v_prev < new.amount_cents then
        raise exception 'Saldo livre insuficiente na conta para este aporte.' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger savings_movements_validate
  before insert or update on public.savings_movements
  for each row execute function public.savings_movements_validate();

create or replace function public.savings_movements_check_non_negative()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_goal    uuid;
  v_account uuid;
  v_net     bigint;
  i         int;
begin
  for i in 1..2 loop
    if i = 1 and tg_op <> 'DELETE' then
      v_goal := new.goal_id; v_account := new.account_id;
    elsif i = 2 and tg_op <> 'INSERT' then
      v_goal := old.goal_id; v_account := old.account_id;
    else
      continue;
    end if;
    select coalesce(sum(case s.kind when 'deposit' then s.amount_cents else -s.amount_cents end), 0)
      into v_net
      from public.savings_movements s
     where s.goal_id = v_goal and s.account_id = v_account;
    if v_net < 0 then
      raise exception 'A retirada é maior que o valor guardado nesta reserva nesta conta.' using errcode = 'P0001';
    end if;
  end loop;
  return null;
end;
$$;

create constraint trigger savings_movements_non_negative
  after insert or update or delete on public.savings_movements
  deferrable initially deferred
  for each row execute function public.savings_movements_check_non_negative();

-- ---------- Ajustes: só a partir da data do saldo inicial -----------
create or replace function public.account_adjustments_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.date < (select initial_balance_date from public.accounts where id = new.account_id) then
    raise exception 'O ajuste não pode ser anterior à data do saldo inicial da conta.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger account_adjustments_validate
  before insert or update on public.account_adjustments
  for each row execute function public.account_adjustments_validate();

-- ---------- updated_at ----------------------------------------------
create trigger accounts_updated_at            before update on public.accounts            for each row execute function public.set_updated_at();
create trigger categories_updated_at          before update on public.categories          for each row execute function public.set_updated_at();
create trigger transactions_updated_at        before update on public.transactions        for each row execute function public.set_updated_at();
create trigger transfers_updated_at           before update on public.transfers           for each row execute function public.set_updated_at();
create trigger account_adjustments_updated_at before update on public.account_adjustments for each row execute function public.set_updated_at();
create trigger savings_goals_updated_at       before update on public.savings_goals       for each row execute function public.set_updated_at();
create trigger savings_movements_updated_at   before update on public.savings_movements   for each row execute function public.set_updated_at();

-- ---------- Row Level Security --------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['accounts','categories','transactions','transfers',
                           'account_adjustments','savings_goals','savings_movements']
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

revoke execute on function public.account_balances(date) from public, anon;
grant  execute on function public.account_balances(date) to authenticated, service_role;

-- ---------- Categorias padrão (idempotente) -------------------------
create or replace function public.ensure_default_categories()
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.categories (name, kind, color, icon, is_fixed)
  values
    ('Salário',          'income',  '#10b981', 'briefcase',      true),
    ('Freelance',        'income',  '#14b8a6', 'laptop',         false),
    ('Rendimentos',      'income',  '#22c55e', 'trending-up',    false),
    ('Reembolsos',       'income',  '#84cc16', 'rotate-ccw',     false),
    ('Outras receitas',  'income',  '#64748b', 'plus-circle',    false),
    ('Moradia',          'expense', '#6366f1', 'home',           true),
    ('Alimentação',      'expense', '#f97316', 'utensils',       false),
    ('Mercado',          'expense', '#f59e0b', 'shopping-cart',  false),
    ('Transporte',       'expense', '#0ea5e9', 'car',            false),
    ('Saúde',            'expense', '#ef4444', 'heart-pulse',    false),
    ('Educação',         'expense', '#8b5cf6', 'graduation-cap', false),
    ('Lazer',            'expense', '#ec4899', 'party-popper',   false),
    ('Assinaturas',      'expense', '#a855f7', 'repeat',         true),
    ('Contas da casa',   'expense', '#3b82f6', 'zap',            true),
    ('Compras',          'expense', '#d946ef', 'shopping-bag',   false),
    ('Cuidados pessoais','expense', '#f43f5e', 'sparkles',       false),
    ('Impostos e taxas', 'expense', '#78716c', 'landmark',       false),
    ('Outras despesas',  'expense', '#64748b', 'circle-ellipsis',false)
  on conflict (user_id, kind, name) do nothing;
$$;

revoke execute on function public.ensure_default_categories() from public, anon;
grant  execute on function public.ensure_default_categories() to authenticated, service_role;
