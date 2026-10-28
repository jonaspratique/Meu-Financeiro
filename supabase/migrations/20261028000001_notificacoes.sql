-- ============================================================================
-- Meu Financeiro — Notificações no celular (Web Push)
--
-- * push_subscriptions: aparelhos que aceitaram receber notificações
-- * notification_log:   o que já foi enviado (não repete o mesmo aviso no dia)
-- * private.app_config: chaves VAPID e segredo do agendador — fora da API
-- * agendamento diário (pg_cron + pg_net) chamando a Edge Function "alerts"
--
-- Não altera nenhuma tabela existente.
-- ============================================================================

-- ---------- Aparelhos inscritos -------------------------------------------
create table public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint         text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh           text not null check (char_length(p256dh) <= 200),
  auth             text not null check (char_length(auth) <= 100),
  user_agent       text check (user_agent is null or char_length(user_agent) <= 300),
  last_success_at  timestamptz,
  failures         int not null default 0,
  created_at       timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_owner on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- ---------- Histórico de envios -------------------------------------------
create table public.notification_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  key         text not null,
  sent_on     date not null,
  title       text,
  created_at  timestamptz not null default now(),
  unique (user_id, key, sent_on)
);
alter table public.notification_log enable row level security;
create policy notification_log_owner_read on public.notification_log
  for select to authenticated using (user_id = (select auth.uid()));
grant select on public.notification_log to authenticated;

-- ---------- Configuração privada (não exposta pela API) --------------------
create schema if not exists private;
revoke all on schema private from public;

create table private.app_config (
  name   text primary key,
  value  text not null
);
revoke all on private.app_config from public;

-- segredo que o agendador envia para a função (gerado aqui, ninguém precisa digitar)
insert into private.app_config (name, value)
values ('cron_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- chave pública VAPID: qualquer usuário logado pode ler (o navegador precisa dela)
create or replace function public.get_vapid_public_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select value from private.app_config where name = 'vapid_public';
$$;
revoke execute on function public.get_vapid_public_key() from public, anon;
grant execute on function public.get_vapid_public_key() to authenticated;

-- configuração completa: só a Edge Function (service_role)
create or replace function public.push_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(name, value), '{}'::jsonb) from private.app_config;
$$;
revoke execute on function public.push_config() from public, anon, authenticated;

-- grava as chaves VAPID geradas pela função na 1ª execução (nunca sobrescreve)
create or replace function public.set_push_config(p_name text, p_value text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.app_config (name, value) values (p_name, p_value)
  on conflict (name) do nothing;
$$;
revoke execute on function public.set_push_config(text, text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_config() to service_role;
    grant execute on function public.set_push_config(text, text) to service_role;
  end if;
end $$;

-- ---------- Agendamento diário: 9h de Brasília (12h UTC) -------------------
-- Só onde pg_cron e pg_net existem (Supabase). O endereço da função fica em
-- private.app_config ('alerts_url'); sem ele, o agendamento não chama nada.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_cron;
    create extension if not exists pg_net with schema extensions;
    perform cron.schedule(
      'meu-financeiro-avisos',
      '0 12 * * *',
      $job$
        select net.http_post(
          url     := c.url,
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', c.secret),
          body    := '{"mode":"cron"}'::jsonb,
          timeout_milliseconds := 60000
        )
        from (
          select (select value from private.app_config where name = 'alerts_url')  as url,
                 (select value from private.app_config where name = 'cron_secret') as secret
        ) c
        where c.url is not null;
      $job$
    );
  end if;
end $$;
