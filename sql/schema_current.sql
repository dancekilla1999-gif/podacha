-- Минимальная текущая схема «Подачи» для пустой тестовой базы (Postgres 17).
-- Снято чтением с прода 26.11.2026. На боевой Supabase этот файл НЕ применять:
-- там схема уже есть. Боевая миграция — только sql/20261126_tg_auth.sql.
-- Роли anon / authenticated / service_role на Supabase уже существуют;
-- здесь они создаются, потому что локальный Postgres их не имеет.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $do$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit;
  end if;
end
$do$;

grant anon, authenticated, service_role to current_user;

create schema if not exists app;
revoke all on schema app from public;

create table if not exists app.owners (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  pass_hash text not null,
  name text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists app.owner_sessions (
  token_hash text primary key,
  owner_id uuid not null references app.owners(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists app.login_attempts (
  id bigserial primary key,
  email text not null,
  at timestamptz not null default now()
);

-- Чат отчётов. Это НЕ вход человека (см. app.tg_links в миграции).
create table if not exists app.tg (
  owner_id uuid primary key references app.owners(id) on delete cascade,
  code text,
  chat_id bigint,
  chat_title text not null default '',
  bound_at timestamptz
);

create table if not exists app.venues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references app.owners(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);

create schema if not exists bill;

create or replace function app.hash_token(p text)
returns text
language sql
immutable
set search_path to pg_catalog
as $fn$
  select encode(extensions.digest(convert_to(coalesce(p, ''), 'UTF8'), 'sha256'), 'hex')
$fn$;

create or replace function app.new_token()
returns text
language sql
set search_path to pg_catalog
as $fn$
  select encode(extensions.gen_random_bytes(24), 'hex')
$fn$;

create or replace function app.clean(p text, n int)
returns text
language sql
immutable
set search_path to pg_catalog
as $fn$
  select left(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', '', 'g'), greatest(n, 0))
$fn$;

create or replace function app.venue_json(v app.venues)
returns jsonb
language sql
stable
set search_path to pg_catalog
as $fn$
  select jsonb_build_object(
    'id', v.id,
    'name', v.name,
    'kind', 'cafe',
    'warmup_size', 5,
    'modules', jsonb_build_array('service'),
    'items', 0,
    'confirmed', 0,
    'staff', 0,
    'created_at', v.created_at
  )
$fn$;

-- Старая проверка: только expires_at. Миграция заменяет эту функцию.
create or replace function app.owner_id(p_token text)
returns uuid
language plpgsql
stable
set search_path to pg_catalog
as $fn$
declare
  v uuid;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'Нужно войти' using hint = 'auth';
  end if;
  select s.owner_id into v from app.owner_sessions s
   where s.token_hash = app.hash_token(p_token) and s.expires_at > now();
  if v is null then
    raise exception 'Сессия закончилась, войдите снова' using hint = 'auth';
  end if;
  return v;
end
$fn$;

create or replace function public.pd_owner_login(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  e text := lower(trim(coalesce(p_email, '')));
  o app.owners;
  t text;
  n int;
begin
  select count(*) into n from app.login_attempts where email = e and at > now() - interval '15 minutes';
  if n >= 10 then
    return jsonb_build_object('error', 'Слишком много попыток. Подождите 15 минут');
  end if;
  select * into o from app.owners where email = e;
  if not found then
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
    insert into app.login_attempts (email) values (e);
    return jsonb_build_object('error', 'Неверная почта или пароль');
  end if;
  if o.pass_hash <> extensions.crypt(coalesce(p_password, ''), o.pass_hash) then
    insert into app.login_attempts (email) values (e);
    return jsonb_build_object('error', 'Неверная почта или пароль');
  end if;
  t := app.new_token();
  insert into app.owner_sessions (token_hash, owner_id, expires_at)
  values (app.hash_token(t), o.id, now() + interval '30 days');
  return jsonb_build_object('token', t, 'email', o.email, 'name', o.name);
end
$fn$;

create or replace function public.pd_owner_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
begin
  update app.owner_sessions set expires_at = now() where token_hash = app.hash_token(p_token);
  return jsonb_build_object('ok', true);
end
$fn$;

create or replace function public.pd_owner_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid := app.owner_id(p_token);
  o app.owners;
begin
  select * into o from app.owners where id = v_owner;
  return jsonb_build_object(
    'email', o.email,
    'name', o.name,
    'venues', coalesce((select jsonb_agg(app.venue_json(v) order by v.created_at) from app.venues v where v.owner_id = v_owner), '[]'::jsonb)
  );
end
$fn$;

create or replace function public.pd_owner_password(p_token text, p_old text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid := app.owner_id(p_token);
  o app.owners;
begin
  select * into o from app.owners where id = v_owner;
  if o.pass_hash <> extensions.crypt(coalesce(p_old, ''), o.pass_hash) then
    raise exception 'Старый пароль не подходит' using hint = 'invalid';
  end if;
  if length(coalesce(p_new, '')) < 8 or length(p_new) > 72 then
    raise exception 'Пароль — от 8 до 72 символов' using hint = 'invalid';
  end if;
  update app.owners set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)) where id = v_owner;
  update app.owner_sessions set expires_at = now() where owner_id = v_owner and token_hash <> app.hash_token(p_token);
  return jsonb_build_object('ok', true);
end
$fn$;

create or replace function public.pd_owner_register(p_email text, p_password text, p_name text default ''::text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  e text := lower(trim(coalesce(p_email, '')));
  o app.owners;
  t text;
begin
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(e) > 200 then
    raise exception 'Проверьте адрес почты' using hint = 'invalid';
  end if;
  if length(coalesce(p_password, '')) < 8 or length(p_password) > 72 then
    raise exception 'Пароль — от 8 до 72 символов' using hint = 'invalid';
  end if;
  if exists (select 1 from app.owners where email = e) then
    raise exception 'Эта почта уже зарегистрирована — войдите' using hint = 'exists';
  end if;
  if (select count(*) from app.owners where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Слишком много регистраций, попробуйте через час' using hint = 'rate';
  end if;
  insert into app.owners (email, pass_hash, name)
  values (e, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), app.clean(p_name, 80))
  returning * into o;
  t := app.new_token();
  insert into app.owner_sessions (token_hash, owner_id, expires_at)
  values (app.hash_token(t), o.id, now() + interval '30 days');
  return jsonb_build_object('token', t, 'email', o.email, 'name', o.name);
end
$fn$;

-- bill.owner_of не меняем: новая проверка приходит через app.owner_id.
create or replace function bill.owner_of(p_product text, p_token text)
returns uuid
language plpgsql
stable
security definer
set search_path to pg_catalog
as $fn$
begin
  return case p_product
    when 'pd' then app.owner_id(p_token)
    when 'zh' then null
    when 'sv' then null
    else null
  end;
end
$fn$;

-- Заглушки RPC кабинета: на проде у них свои тела, все ходят в app.owner_id.
-- В тестовой базе достаточно вызова owner_id, чтобы погашенный токен отказал.
create or replace function public.pd_agent(p_token text, p_op text default '', p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_last_venue(p_token text)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_menu_confirm(p_token text, p_venue uuid default null)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_menu_filter(p_token text, p_venue uuid default null)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_menu_get(p_token text, p_venue uuid default null)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '[]'::jsonb; end $fn$;

create or replace function public.pd_menu_import(p_token text, p_venue uuid default null, p_items jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_menu_item_delete(p_token text, p_venue uuid default null, p_item uuid default null)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_menu_item_save(p_token text, p_venue uuid default null, p_item jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_report(p_token text, p_venue uuid default null, p_days int default 7)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_report_days(p_token text, p_venue uuid default null)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_staff_new_link(p_token text, p_staff uuid default null)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_staff_update(p_token text, p_staff uuid default null, p_patch jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_team_get(p_token text, p_venue uuid default null)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_venue_create(p_token text, p_name text default '', p_kind text default 'cafe')
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_venue_new_invite(p_token text, p_venue uuid default null)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_venue_update(p_token text, p_venue uuid default null, p_patch jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to pg_catalog as $fn$
begin perform app.owner_id(p_token); return '{"ok":true}'::jsonb; end $fn$;

create or replace function public.pd_bill_status(p_token text)
returns jsonb language plpgsql stable security definer set search_path to pg_catalog as $fn$
declare v uuid;
begin
  v := bill.owner_of('pd', p_token);
  return jsonb_build_object('ok', true);
end
$fn$;

revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all sequences in schema app from public, anon, authenticated;
