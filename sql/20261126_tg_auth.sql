-- Подача: вход через Telegram Mini App и сессии сайта.
-- Чистый Postgres (роли anon / authenticated / service_role — как в Supabase).
-- На боевую базу НЕ накатывать из CI. Применяет человек после проверки.
-- Секрет TG_SESSION_SECRET в этот файл не входит. После применения его один раз
-- кладёт оператор (значение — из env сервера, не из чата):
--   insert into app.server_secrets(key, value) values ('tg_session_secret', '<TG_SESSION_SECRET>')
--   on conflict (key) do update set value = excluded.value;
-- Ротация: записать новый в tg_session_secret, прежний — в tg_session_secret_prev,
-- обновить env, затем удалить tg_session_secret_prev.

-- ---------------------------------------------------------------------------
-- столбцы сессий и владельца
-- ---------------------------------------------------------------------------

alter table app.owners add column if not exists disabled_at timestamptz;

alter table app.owner_sessions add column if not exists id uuid;
update app.owner_sessions set id = gen_random_uuid() where id is null;
alter table app.owner_sessions alter column id set default gen_random_uuid();
alter table app.owner_sessions alter column id set not null;

alter table app.owner_sessions add column if not exists kind text;
update app.owner_sessions set kind = 'web' where kind is null;
alter table app.owner_sessions alter column kind set default 'web';
alter table app.owner_sessions alter column kind set not null;

alter table app.owner_sessions add column if not exists token_role text;
update app.owner_sessions set token_role = 'legacy' where token_role is null;
alter table app.owner_sessions alter column token_role set default 'legacy';
alter table app.owner_sessions alter column token_role set not null;

alter table app.owner_sessions add column if not exists tg_user_id bigint;
alter table app.owner_sessions add column if not exists device_key text;
alter table app.owner_sessions add column if not exists device_label text;
alter table app.owner_sessions add column if not exists created_ip_hash text;
alter table app.owner_sessions add column if not exists last_used_at timestamptz;
update app.owner_sessions set last_used_at = coalesce(created_at, now()) where last_used_at is null;
alter table app.owner_sessions alter column last_used_at set default now();
alter table app.owner_sessions alter column last_used_at set not null;
alter table app.owner_sessions add column if not exists abs_expires_at timestamptz;
alter table app.owner_sessions add column if not exists revoked_at timestamptz;
alter table app.owner_sessions add column if not exists revoke_reason text;
alter table app.owner_sessions add column if not exists rotated_at timestamptz;
alter table app.owner_sessions add column if not exists parent_hash text;
alter table app.owner_sessions add column if not exists grace_cipher text;
alter table app.owner_sessions add column if not exists grace_expires_at timestamptz;
alter table app.owner_sessions add column if not exists family_id uuid;
update app.owner_sessions set family_id = gen_random_uuid() where family_id is null;
alter table app.owner_sessions alter column family_id set default gen_random_uuid();
alter table app.owner_sessions alter column family_id set not null;

do $do$
begin
  alter table app.owner_sessions add constraint owner_sessions_kind_chk check (kind in ('web', 'tg'));
exception when duplicate_object then null;
end
$do$;

do $do$
begin
  alter table app.owner_sessions add constraint owner_sessions_role_chk check (token_role in ('legacy', 'access', 'refresh', 'tg'));
exception when duplicate_object then null;
end
$do$;

do $do$
begin
  alter table app.owner_sessions add constraint owner_sessions_reason_chk check (
    revoke_reason is null or revoke_reason in (
      'logout', 'logout_all', 'password', 'admin', 'unbind', 'rotated', 'refresh_reuse', 'device_end'
    )
  );
exception when duplicate_object then null;
end
$do$;

create unique index if not exists owner_sessions_id_uq on app.owner_sessions (id);
create index if not exists owner_sessions_owner_idx on app.owner_sessions (owner_id);
create index if not exists owner_sessions_family_idx on app.owner_sessions (family_id);
create index if not exists owner_sessions_tg_device_idx on app.owner_sessions (tg_user_id, device_key) where kind = 'tg';

-- ---------------------------------------------------------------------------
-- вход человека через Telegram (не путать с app.tg — там чат отчётов)
-- ---------------------------------------------------------------------------

create table if not exists app.tg_links (
  tg_user_id bigint primary key,
  owner_id uuid not null unique references app.owners (id) on delete cascade,
  tg_username text,
  tg_first_name text,
  bound_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists app.tg_link_codes (
  code_hash text primary key,
  owner_id uuid not null references app.owners (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists tg_link_codes_owner_idx on app.tg_link_codes (owner_id, created_at);

create table if not exists app.consents (
  id bigserial primary key,
  owner_id uuid not null references app.owners (id) on delete cascade,
  kind text not null,
  version text not null,
  tg_user_id bigint,
  at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table if not exists app.tg_initdata_used (
  hash_sha256 text primary key,
  expires_at timestamptz not null
);

create table if not exists app.auth_events (
  id bigserial primary key,
  owner_id uuid,
  kind text not null,
  tg_user_id bigint,
  ip_hash text,
  device_label text,
  at timestamptz not null default now()
);

create index if not exists auth_events_at_idx on app.auth_events (at);
create index if not exists auth_events_owner_idx on app.auth_events (owner_id, at);

create table if not exists app.rate_hits (
  id bigserial primary key,
  bucket text not null,
  subject text not null,
  at timestamptz not null default now()
);

create index if not exists rate_hits_idx on app.rate_hits (bucket, subject, at);

create table if not exists app.auth_signals (
  id bigserial primary key,
  status int not null,
  at timestamptz not null default now()
);

create table if not exists app.auth_alerts (
  kind text primary key,
  at timestamptz not null
);

create table if not exists app.server_secrets (
  key text primary key,
  value text not null
);

create table if not exists app.owner_invites (
  code_hash text primary key,
  note text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references app.owners (id)
);

-- ---------------------------------------------------------------------------
-- служебные функции схемы app (PostgREST их не публикует)
-- ---------------------------------------------------------------------------

create or replace function app.secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path to pg_catalog
as $fn$
  select coalesce(p_secret, '') <> ''
     and length(p_secret) >= 16
     and exists (
       select 1 from app.server_secrets s
        where s.key in ('tg_session_secret', 'tg_session_secret_prev')
          and s.value = p_secret
     )
$fn$;

create or replace function app.auth_event(
  p_owner uuid, p_kind text, p_tg bigint, p_ip text, p_label text
) returns void
language plpgsql
volatile
security definer
set search_path to pg_catalog
as $fn$
begin
  insert into app.auth_events (owner_id, kind, tg_user_id, ip_hash, device_label)
  values (
    p_owner, p_kind, p_tg, p_ip,
    left(regexp_replace(coalesce(p_label, ''), '[[:cntrl:]]', '', 'g'), 80)
  );
end
$fn$;

create or replace function app.email_block_min(p_email text)
returns int
language plpgsql
stable
security definer
set search_path to pg_catalog
as $fn$
declare
  n int;
  oldest timestamptz;
begin
  select count(*), min(at) into n, oldest
    from app.login_attempts
   where email = p_email and at > now() - interval '15 minutes';
  if coalesce(n, 0) >= 10 then
    return greatest(1, ceil(extract(epoch from (oldest + interval '15 minutes' - now())) / 60.0)::int);
  end if;
  return 0;
end
$fn$;

create or replace function app.hit_block_min(p_bucket text, p_subject text, p_limit int, p_window interval)
returns int
language plpgsql
stable
security definer
set search_path to pg_catalog
as $fn$
declare
  n int;
  oldest timestamptz;
begin
  if p_subject is null or p_subject = '' or p_limit is null then
    return 0;
  end if;
  select count(*), min(at) into n, oldest
    from app.rate_hits
   where bucket = p_bucket and subject = p_subject and at > now() - p_window;
  if coalesce(n, 0) >= p_limit then
    return greatest(1, ceil(extract(epoch from (oldest + p_window - now())) / 60.0)::int);
  end if;
  return 0;
end
$fn$;

create or replace function app.owner_me_json(p_owner uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to pg_catalog
as $fn$
declare
  o app.owners;
begin
  select * into o from app.owners where id = p_owner;
  return jsonb_build_object(
    'email', o.email,
    'name', o.name,
    'venues', coalesce(
      (select jsonb_agg(app.venue_json(v) order by v.created_at) from app.venues v where v.owner_id = p_owner),
      '[]'::jsonb
    )
  );
end
$fn$;

-- STABLE: только проверка, ничего не пишет.
create or replace function app.owner_id(p_token text)
returns uuid
language plpgsql
stable
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid;
  v_revoked timestamptz;
  v_reason text;
  v_exp timestamptz;
  v_abs timestamptz;
  v_role text;
  v_disabled timestamptz;
begin
  if p_token is null or length(p_token) < 20 then
    raise exception 'Нужно войти' using hint = 'auth';
  end if;
  select s.owner_id, s.revoked_at, s.revoke_reason, s.expires_at, s.abs_expires_at, s.token_role, o.disabled_at
    into v_owner, v_revoked, v_reason, v_exp, v_abs, v_role, v_disabled
    from app.owner_sessions s
    left join app.owners o on o.id = s.owner_id
   where s.token_hash = app.hash_token(p_token);
  if not found then
    raise exception 'Нужно войти' using hint = 'auth';
  end if;
  if v_disabled is not null then
    raise exception 'Аккаунт отключён' using hint = 'disabled';
  end if;
  if v_role = 'refresh' then
    raise exception 'Нужно войти' using hint = 'auth';
  end if;
  if v_reason in ('logout', 'logout_all', 'password', 'admin', 'unbind', 'device_end', 'refresh_reuse') then
    raise exception 'Сессия завершена' using hint = 'revoked';
  end if;
  if v_revoked is not null
     or v_exp <= now()
     or (v_abs is not null and v_abs <= now()) then
    raise exception 'Сессия устарела' using hint = 'expired';
  end if;
  return v_owner;
end
$fn$;

-- VOLATILE: продление отдельно от owner_id.
create or replace function app.session_touch(p_token text)
returns void
language plpgsql
volatile
security definer
set search_path to pg_catalog
as $fn$
begin
  update app.owner_sessions s
     set last_used_at = now(),
         expires_at = case
           when s.kind = 'tg'
            and s.expires_at < now() + interval '7 days' - interval '1 hour'
            and (s.abs_expires_at is null or s.abs_expires_at > now())
           then least(now() + interval '7 days', coalesce(s.abs_expires_at, now() + interval '7 days'))
           else s.expires_at
         end
   where s.token_hash = app.hash_token(p_token)
     and s.revoked_at is null
     and s.expires_at > now()
     and (s.abs_expires_at is null or s.abs_expires_at > now())
     and s.token_role in ('access', 'tg', 'legacy');
end
$fn$;

create or replace function app.consume_initdata(p_hash text)
returns boolean
language plpgsql
volatile
security definer
set search_path to pg_catalog
as $fn$
declare
  v text;
begin
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  insert into app.tg_initdata_used (hash_sha256, expires_at)
  values (p_hash, now() + interval '1 hour 1 minute')
  on conflict do nothing
  returning hash_sha256 into v;
  return v is not null;
end
$fn$;

create or replace function app.tg_issue(
  p_owner uuid, p_tg bigint, p_device_key text, p_device_label text, p_ip text
) returns text
language plpgsql
volatile
security definer
set search_path to pg_catalog
as $fn$
declare
  t text;
  n int;
  old_hash text;
  v_label text := left(regexp_replace(coalesce(p_device_label, ''), '[[:cntrl:]]', '', 'g'), 80);
begin
  if p_device_key is null or p_device_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Нет устройства' using hint = 'invalid';
  end if;
  update app.owner_sessions
     set revoked_at = now(), revoke_reason = 'rotated', grace_cipher = null, grace_expires_at = null
   where owner_id = p_owner
     and kind = 'tg'
     and tg_user_id = p_tg
     and device_key = p_device_key
     and revoked_at is null;

  select count(*) into n
    from app.owner_sessions
   where owner_id = p_owner
     and kind = 'tg'
     and revoked_at is null
     and expires_at > now()
     and (abs_expires_at is null or abs_expires_at > now());
  if n >= 5 then
    select token_hash into old_hash
      from app.owner_sessions
     where owner_id = p_owner
       and kind = 'tg'
       and revoked_at is null
       and expires_at > now()
       and (abs_expires_at is null or abs_expires_at > now())
     order by last_used_at asc, created_at asc
     limit 1;
    update app.owner_sessions
       set revoked_at = now(), revoke_reason = 'rotated', grace_cipher = null, grace_expires_at = null
     where token_hash = old_hash;
  end if;

  t := app.new_token();
  insert into app.owner_sessions (
    token_hash, owner_id, expires_at, kind, token_role, tg_user_id, device_key, device_label,
    created_ip_hash, last_used_at, abs_expires_at, family_id
  ) values (
    app.hash_token(t), p_owner, now() + interval '7 days', 'tg', 'tg', p_tg, p_device_key, v_label,
    p_ip, now(), now() + interval '30 days', gen_random_uuid()
  );
  update app.tg_links set last_seen_at = now() where tg_user_id = p_tg and owner_id = p_owner;
  return t;
end
$fn$;

create or replace function app.bind_tg(
  p_owner uuid, p_tg bigint, p_username text, p_first text, p_version text
) returns void
language plpgsql
volatile
security definer
set search_path to pg_catalog
as $fn$
declare
  other_owner uuid;
  other_tg bigint;
begin
  select owner_id into other_owner from app.tg_links where tg_user_id = p_tg;
  if found and other_owner <> p_owner then
    raise exception 'Этот Telegram уже привязан к другому аккаунту. Сначала отвяжите его там' using hint = 'conflict';
  end if;
  select tg_user_id into other_tg from app.tg_links where owner_id = p_owner;
  if found and other_tg <> p_tg then
    raise exception 'К этому аккаунту уже привязан другой Telegram' using hint = 'conflict';
  end if;
  insert into app.tg_links (tg_user_id, owner_id, tg_username, tg_first_name)
  values (
    p_tg, p_owner,
    left(regexp_replace(coalesce(p_username, ''), '[[:cntrl:]]', '', 'g'), 64),
    left(regexp_replace(coalesce(p_first, ''), '[[:cntrl:]]', '', 'g'), 80)
  )
  on conflict (tg_user_id) do update
    set tg_username = excluded.tg_username,
        tg_first_name = excluded.tg_first_name,
        last_seen_at = now();
  insert into app.consents (owner_id, kind, version, tg_user_id)
  values (p_owner, 'tg_login', coalesce(nullif(p_version, ''), '2026-11-26'), p_tg);
  perform app.auth_event(p_owner, 'tg_link', p_tg, null, null);
end
$fn$;

-- ---------------------------------------------------------------------------
-- кабинет: проверка сессии, пароль, выход, регистрация только по приглашению
-- ---------------------------------------------------------------------------

create or replace function public.pd_owner_me(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid := app.owner_id(p_token);
begin
  perform app.session_touch(p_token);
  return app.owner_me_json(v_owner);
end
$fn$;

create or replace function public.pd_owner_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid := app.owner_id(p_token);
  v_family uuid;
begin
  select family_id into v_family
    from app.owner_sessions where token_hash = app.hash_token(p_token);
  update app.owner_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoke_reason = case when revoked_at is null then 'logout' else revoke_reason end,
         grace_cipher = null,
         grace_expires_at = null
   where family_id = v_family and owner_id = v_owner;
  return jsonb_build_object('ok', true);
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
  v_kind text;
  v_family uuid;
begin
  select * into o from app.owners where id = v_owner;
  if o.pass_hash <> extensions.crypt(coalesce(p_old, ''), o.pass_hash) then
    raise exception 'Старый пароль не подходит' using hint = 'invalid';
  end if;
  if length(coalesce(p_new, '')) < 8 or length(p_new) > 72 then
    raise exception 'Пароль — от 8 до 72 символов' using hint = 'invalid';
  end if;
  select kind, family_id into v_kind, v_family
    from app.owner_sessions where token_hash = app.hash_token(p_token);

  update app.owners
     set pass_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10))
   where id = v_owner;

  if v_kind = 'tg' then
    update app.owner_sessions
       set revoked_at = now(), revoke_reason = 'password', grace_cipher = null, grace_expires_at = null
     where owner_id = v_owner and revoked_at is null and token_hash <> app.hash_token(p_token);
  else
    update app.owner_sessions
       set revoked_at = now(), revoke_reason = 'password', grace_cipher = null, grace_expires_at = null
     where owner_id = v_owner and revoked_at is null and family_id is distinct from v_family;
    delete from app.tg_links where owner_id = v_owner;
    update app.consents
       set withdrawn_at = now()
     where owner_id = v_owner and kind = 'tg_login' and withdrawn_at is null;
  end if;
  perform app.auth_event(v_owner, 'password_change', null, null, null);
  return jsonb_build_object('ok', true);
end
$fn$;

-- Прямой вызов с сайта больше не выдаёт сессию: регистрация только по приглашению через API.
create or replace function public.pd_owner_register(p_email text, p_password text, p_name text default ''::text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
begin
  raise exception 'Регистрация только по приглашению' using hint = 'invite';
end
$fn$;

-- Прямой вызов не выдаёт долгоживущий токен. Вход — POST /api/auth/login.
create or replace function public.pd_owner_login(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
begin
  raise exception 'Войдите через кабинет на сайте' using hint = 'auth';
end
$fn$;

-- ---------------------------------------------------------------------------
-- функции только для сервера (service_role). anon получает permission denied.
-- ---------------------------------------------------------------------------

create or replace function public.pd_rate_bump(
  p_bucket text, p_subject text, p_limit int, p_window_sec int, p_secret text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  n int;
  oldest timestamptz;
  mins int;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  if p_subject is null or p_subject = '' then
    return jsonb_build_object('limited', false);
  end if;
  insert into app.rate_hits (bucket, subject) values (p_bucket, p_subject);
  select count(*), min(at) into n, oldest
    from app.rate_hits
   where bucket = p_bucket and subject = p_subject and at > now() - make_interval(secs => p_window_sec);
  if n > p_limit then
    mins := greatest(1, ceil(extract(epoch from (oldest + make_interval(secs => p_window_sec) - now())) / 60.0)::int);
    return jsonb_build_object('limited', true, 'retry_min', mins);
  end if;
  return jsonb_build_object('limited', false);
end
$fn$;

create or replace function public.pd_tg_session(
  p_tg_user_id bigint,
  p_first_name text,
  p_username text,
  p_device_key text,
  p_device_label text,
  p_ip_hash text,
  p_secret text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid;
  t text;
  v_disabled timestamptz;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  select l.owner_id, o.disabled_at into v_owner, v_disabled
    from app.tg_links l
    join app.owners o on o.id = l.owner_id
   where l.tg_user_id = p_tg_user_id;
  if not found then
    return jsonb_build_object(
      'need_link', true,
      'tg', jsonb_build_object('first_name', left(coalesce(p_first_name, ''), 80))
    );
  end if;
  if v_disabled is not null then
    perform app.auth_event(v_owner, 'disabled', p_tg_user_id, p_ip_hash, p_device_label);
    raise exception 'Аккаунт отключён' using hint = 'disabled';
  end if;
  update app.tg_links
     set tg_username = left(coalesce(p_username, tg_username), 64),
         tg_first_name = left(coalesce(p_first_name, tg_first_name), 80),
         last_seen_at = now()
   where tg_user_id = p_tg_user_id;
  t := app.tg_issue(v_owner, p_tg_user_id, p_device_key, p_device_label, p_ip_hash);
  perform app.auth_event(v_owner, 'login_ok', p_tg_user_id, p_ip_hash, p_device_label);
  return jsonb_build_object('token', t, 'me', app.owner_me_json(v_owner));
end
$fn$;

create or replace function public.pd_link_code_consume(p_code text, p_secret text)
returns uuid
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v uuid;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  update app.tg_link_codes
     set used_at = now()
   where code_hash = app.hash_token(p_code)
     and used_at is null
     and expires_at > now()
   returning owner_id into v;
  return v;
end
$fn$;

create or replace function public.pd_tg_link(
  p_tg_user_id bigint,
  p_first_name text,
  p_username text,
  p_device_key text,
  p_device_label text,
  p_ip_hash text,
  p_code text,
  p_init_hash text,
  p_consent boolean,
  p_consent_version text,
  p_secret text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid;
  t text;
  mins int;
  v_disabled timestamptz;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  if p_consent is not true then
    return jsonb_build_object('error', 'Нужно согласие', 'hint', 'consent');
  end if;
  mins := app.hit_block_min('link_tg', p_tg_user_id::text, 10, interval '15 minutes');
  if mins = 0 then
    mins := app.hit_block_min('link_ip', coalesce(p_ip_hash, ''), 30, interval '15 minutes');
  end if;
  if mins > 0 then
    return jsonb_build_object('error', 'Слишком много попыток, подождите ' || mins || ' мин', 'status', 429, 'retry_min', mins);
  end if;

  if p_code is null or length(p_code) < 22 then
    insert into app.rate_hits (bucket, subject) values ('link_tg', p_tg_user_id::text);
    if p_ip_hash is not null and p_ip_hash <> '' then
      insert into app.rate_hits (bucket, subject) values ('link_ip', p_ip_hash);
    end if;
    return jsonb_build_object('error', 'Код не подошёл или устарел');
  end if;

  v_owner := public.pd_link_code_consume(p_code, p_secret);
  if v_owner is null then
    insert into app.rate_hits (bucket, subject) values ('link_tg', p_tg_user_id::text);
    if p_ip_hash is not null and p_ip_hash <> '' then
      insert into app.rate_hits (bucket, subject) values ('link_ip', p_ip_hash);
    end if;
    return jsonb_build_object('error', 'Код не подошёл или устарел');
  end if;

  if not app.consume_initdata(p_init_hash) then
    raise exception 'REPLAY' using hint = 'replay';
  end if;

  select disabled_at into v_disabled from app.owners where id = v_owner;
  if v_disabled is not null then
    raise exception 'Аккаунт отключён' using hint = 'disabled';
  end if;

  perform app.bind_tg(v_owner, p_tg_user_id, p_username, p_first_name, p_consent_version);
  t := app.tg_issue(v_owner, p_tg_user_id, p_device_key, p_device_label, p_ip_hash);
  return jsonb_build_object('token', t, 'me', app.owner_me_json(v_owner));
end
$fn$;

create or replace function public.pd_tg_login(
  p_tg_user_id bigint,
  p_first_name text,
  p_username text,
  p_device_key text,
  p_device_label text,
  p_ip_hash text,
  p_email text,
  p_password text,
  p_init_hash text,
  p_consent boolean,
  p_consent_version text,
  p_secret text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  e text := lower(trim(coalesce(p_email, '')));
  o app.owners;
  t text;
  mins int;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  if p_consent is not true then
    return jsonb_build_object('error', 'Нужно согласие', 'hint', 'consent');
  end if;
  mins := app.email_block_min(e);
  if mins = 0 then
    mins := app.hit_block_min('login_ip', coalesce(p_ip_hash, ''), 30, interval '15 minutes');
  end if;
  if mins > 0 then
    return jsonb_build_object('error', 'Слишком много попыток, подождите ' || mins || ' мин', 'status', 429, 'retry_min', mins);
  end if;

  select * into o from app.owners where email = e;
  if not found then
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
    insert into app.login_attempts (email) values (e);
    if p_ip_hash is not null and p_ip_hash <> '' then
      insert into app.rate_hits (bucket, subject) values ('login_ip', p_ip_hash);
    end if;
    perform app.auth_event(null, 'login_fail', p_tg_user_id, p_ip_hash, p_device_label);
    return jsonb_build_object('error', 'Неверная почта или пароль');
  end if;
  if o.pass_hash <> extensions.crypt(coalesce(p_password, ''), o.pass_hash) then
    insert into app.login_attempts (email) values (e);
    if p_ip_hash is not null and p_ip_hash <> '' then
      insert into app.rate_hits (bucket, subject) values ('login_ip', p_ip_hash);
    end if;
    perform app.auth_event(null, 'login_fail', p_tg_user_id, p_ip_hash, p_device_label);
    return jsonb_build_object('error', 'Неверная почта или пароль');
  end if;
  if o.disabled_at is not null then
    raise exception 'Аккаунт отключён' using hint = 'disabled';
  end if;

  if not app.consume_initdata(p_init_hash) then
    raise exception 'REPLAY' using hint = 'replay';
  end if;

  perform app.bind_tg(o.id, p_tg_user_id, p_username, p_first_name, p_consent_version);
  t := app.tg_issue(o.id, p_tg_user_id, p_device_key, p_device_label, p_ip_hash);
  perform app.auth_event(o.id, 'login_ok', p_tg_user_id, p_ip_hash, p_device_label);
  return jsonb_build_object('token', t, 'me', app.owner_me_json(o.id));
end
$fn$;

create or replace function public.pd_link_code_issue(p_token text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid := app.owner_id(p_token);
  n int;
  code text;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  select count(*) into n from app.tg_link_codes
   where owner_id = v_owner and created_at > now() - interval '1 hour';
  if n >= 5 then
    return jsonb_build_object('error', 'Слишком много попыток, подождите 60 мин', 'status', 429, 'retry_min', 60);
  end if;
  code := rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=');
  insert into app.tg_link_codes (code_hash, owner_id, expires_at)
  values (app.hash_token(code), v_owner, now() + interval '10 minutes');
  perform app.auth_event(v_owner, 'link_code_issued', null, null, null);
  return jsonb_build_object('code', code, 'expires_at', now() + interval '10 minutes');
end
$fn$;

create or replace function public.pd_link_status(p_token text, p_code text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid := app.owner_id(p_token);
  v_used timestamptz;
  v_exp timestamptz;
  v_code_owner uuid;
  v_user text;
  v_bound timestamptz;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  select owner_id, used_at, expires_at into v_code_owner, v_used, v_exp
    from app.tg_link_codes where code_hash = app.hash_token(coalesce(p_code, ''));
  if not found or v_code_owner <> v_owner then
    return jsonb_build_object('state', 'unknown');
  end if;
  if v_used is null and v_exp > now() then
    return jsonb_build_object('state', 'pending');
  end if;
  if v_used is null then
    return jsonb_build_object('state', 'expired');
  end if;
  select tg_username, bound_at into v_user, v_bound from app.tg_links where owner_id = v_owner;
  if not found then
    return jsonb_build_object('state', 'unlinked');
  end if;
  return jsonb_build_object(
    'state', 'linked',
    'username', v_user,
    'bound_at', v_bound,
    'dispute_open', v_bound > now() - interval '24 hours'
  );
end
$fn$;

create or replace function public.pd_tg_unbind(p_token text, p_reason text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid := app.owner_id(p_token);
  v_kind text := case when p_reason = 'tg_unlink_disputed' then 'tg_unlink_disputed' else 'tg_unlink' end;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  update app.owner_sessions
     set revoked_at = coalesce(revoked_at, now()),
         revoke_reason = case when revoked_at is null then 'unbind' else revoke_reason end,
         grace_cipher = null
   where owner_id = v_owner and kind = 'tg';
  delete from app.tg_links where owner_id = v_owner;
  update app.consents
     set withdrawn_at = now()
   where owner_id = v_owner and kind = 'tg_login' and withdrawn_at is null;
  perform app.auth_event(v_owner, v_kind, null, null, null);
  return jsonb_build_object('ok', true);
end
$fn$;

create or replace function app.web_pair(
  p_owner uuid, p_family uuid, p_access text, p_refresh text, p_label text, p_ip text, p_parent text
) returns void
language plpgsql
volatile
security definer
set search_path to pg_catalog
as $fn$
declare
  v_label text := left(regexp_replace(coalesce(p_label, ''), '[[:cntrl:]]', '', 'g'), 80);
begin
  insert into app.owner_sessions (
    token_hash, owner_id, expires_at, kind, token_role, device_label, created_ip_hash,
    last_used_at, family_id, parent_hash
  ) values
    (app.hash_token(p_access), p_owner, now() + interval '15 minutes', 'web', 'access', v_label, p_ip, now(), p_family, p_parent),
    (app.hash_token(p_refresh), p_owner, now() + interval '365 days', 'web', 'refresh', v_label, p_ip, now(), p_family, p_parent);
end
$fn$;

create or replace function public.pd_web_register(
  p_email text, p_password text, p_name text, p_invite text,
  p_access text, p_refresh text, p_device_label text, p_ip_hash text, p_secret text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  e text := lower(trim(coalesce(p_email, '')));
  o app.owners;
  v_hash text;
  v_family uuid := gen_random_uuid();
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
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
  select code_hash into v_hash
    from app.owner_invites
   where code_hash = app.hash_token(coalesce(p_invite, ''))
     and used_at is null
     and expires_at > now()
   for update;
  if not found then
    raise exception 'Регистрация только по приглашению' using hint = 'invite';
  end if;
  insert into app.owners (email, pass_hash, name)
  values (e, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), app.clean(p_name, 80))
  returning * into o;
  update app.owner_invites set used_at = now(), used_by = o.id where code_hash = v_hash;
  perform app.web_pair(o.id, v_family, p_access, p_refresh, p_device_label, p_ip_hash, null);
  perform app.auth_event(o.id, 'login_ok', null, p_ip_hash, p_device_label);
  return jsonb_build_object('email', o.email, 'name', o.name);
end
$fn$;

create or replace function public.pd_web_login(
  p_email text, p_password text, p_access text, p_refresh text,
  p_device_label text, p_ip_hash text, p_secret text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  e text := lower(trim(coalesce(p_email, '')));
  o app.owners;
  mins int;
  v_family uuid := gen_random_uuid();
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  mins := app.email_block_min(e);
  if mins = 0 then
    mins := app.hit_block_min('login_ip', coalesce(p_ip_hash, ''), 30, interval '15 minutes');
  end if;
  if mins > 0 then
    return jsonb_build_object('error', 'Слишком много попыток, подождите ' || mins || ' мин', 'status', 429, 'retry_min', mins);
  end if;
  select * into o from app.owners where email = e;
  if not found then
    perform extensions.crypt(coalesce(p_password, ''), extensions.gen_salt('bf', 10));
    insert into app.login_attempts (email) values (e);
    if p_ip_hash is not null and p_ip_hash <> '' then
      insert into app.rate_hits (bucket, subject) values ('login_ip', p_ip_hash);
    end if;
    perform app.auth_event(null, 'login_fail', null, p_ip_hash, p_device_label);
    return jsonb_build_object('error', 'Неверная почта или пароль');
  end if;
  if o.pass_hash <> extensions.crypt(coalesce(p_password, ''), o.pass_hash) then
    insert into app.login_attempts (email) values (e);
    if p_ip_hash is not null and p_ip_hash <> '' then
      insert into app.rate_hits (bucket, subject) values ('login_ip', p_ip_hash);
    end if;
    perform app.auth_event(null, 'login_fail', null, p_ip_hash, p_device_label);
    return jsonb_build_object('error', 'Неверная почта или пароль');
  end if;
  if o.disabled_at is not null then
    perform app.auth_event(o.id, 'disabled', null, p_ip_hash, p_device_label);
    raise exception 'Аккаунт отключён' using hint = 'disabled';
  end if;
  perform app.web_pair(o.id, v_family, p_access, p_refresh, p_device_label, p_ip_hash, null);
  perform app.auth_event(o.id, 'login_ok', null, p_ip_hash, p_device_label);
  return jsonb_build_object('email', o.email, 'name', o.name);
end
$fn$;

create or replace function public.pd_web_refresh(
  p_refresh text, p_new_access text, p_new_refresh text, p_grace_cipher text, p_secret text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  s app.owner_sessions;
  v_disabled timestamptz;
  v_family uuid;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  select * into s from app.owner_sessions
   where token_hash = app.hash_token(p_refresh)
   for update;
  if not found or s.token_role <> 'refresh' then
    return jsonb_build_object('hint', 'auth');
  end if;
  select disabled_at into v_disabled from app.owners where id = s.owner_id;
  if v_disabled is not null then
    perform app.auth_event(s.owner_id, 'disabled', null, null, s.device_label);
    return jsonb_build_object('hint', 'disabled');
  end if;
  if s.revoke_reason = 'refresh_reuse' then
    return jsonb_build_object('theft', true, 'already', true);
  end if;
  if s.revoke_reason in ('logout', 'logout_all', 'password', 'admin', 'unbind', 'device_end') then
    return jsonb_build_object('hint', 'revoked');
  end if;
  if s.rotated_at is not null or s.revoke_reason = 'rotated' then
    if s.grace_cipher is not null and s.grace_expires_at is not null and s.grace_expires_at > now() then
      return jsonb_build_object('reuse', true, 'grace_cipher', s.grace_cipher);
    end if;
    update app.owner_sessions
       set revoked_at = coalesce(revoked_at, now()),
           revoke_reason = 'refresh_reuse',
           grace_cipher = null,
           grace_expires_at = null
     where family_id = s.family_id;
    perform app.auth_event(s.owner_id, 'refresh_reuse', null, s.created_ip_hash, s.device_label);
    return jsonb_build_object('theft', true);
  end if;
  if s.expires_at <= now() or (s.abs_expires_at is not null and s.abs_expires_at <= now()) then
    return jsonb_build_object('hint', 'expired');
  end if;
  v_family := s.family_id;
  update app.owner_sessions
     set rotated_at = now(),
         revoked_at = now(),
         revoke_reason = 'rotated',
         grace_cipher = p_grace_cipher,
         grace_expires_at = now() + interval '60 seconds'
   where token_hash = s.token_hash;
  perform app.web_pair(s.owner_id, v_family, p_new_access, p_new_refresh, s.device_label, s.created_ip_hash, s.token_hash);
  update app.owner_sessions
     set expires_at = now() + interval '365 days', last_used_at = now()
   where token_hash = app.hash_token(p_new_refresh);
  return jsonb_build_object('ok', true);
end
$fn$;

create or replace function public.pd_web_migrate(
  p_token text, p_access text, p_refresh text, p_grace_cipher text,
  p_device_label text, p_ip_hash text, p_secret text
) returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  s app.owner_sessions;
  v_disabled timestamptz;
  v_family uuid := gen_random_uuid();
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  select * into s from app.owner_sessions where token_hash = app.hash_token(p_token) for update;
  if not found or s.token_role not in ('legacy', 'access') or s.kind = 'tg' then
    return jsonb_build_object('hint', 'auth');
  end if;
  select disabled_at into v_disabled from app.owners where id = s.owner_id;
  if v_disabled is not null then
    return jsonb_build_object('hint', 'disabled');
  end if;
  if s.grace_cipher is not null and s.grace_expires_at is not null and s.grace_expires_at > now() and s.revoke_reason = 'rotated' then
    return jsonb_build_object('reuse', true, 'grace_cipher', s.grace_cipher);
  end if;
  if s.revoked_at is not null or s.expires_at <= now() then
    return jsonb_build_object('hint', 'expired');
  end if;
  perform app.web_pair(s.owner_id, v_family, p_access, p_refresh, coalesce(p_device_label, s.device_label), p_ip_hash, s.token_hash);
  update app.owner_sessions
     set revoked_at = now(), revoke_reason = 'rotated',
         grace_cipher = p_grace_cipher, grace_expires_at = now() + interval '60 seconds'
   where token_hash = s.token_hash;
  return jsonb_build_object('ok', true, 'email', (select email from app.owners where id = s.owner_id));
end
$fn$;

create or replace function public.pd_web_logout(p_token text, p_all boolean, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid := app.owner_id(p_token);
  v_family uuid;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  select family_id into v_family from app.owner_sessions where token_hash = app.hash_token(p_token);
  if p_all then
    update app.owner_sessions
       set revoked_at = coalesce(revoked_at, now()),
           revoke_reason = case when revoked_at is null then 'logout_all' else revoke_reason end,
           grace_cipher = null, grace_expires_at = null
     where owner_id = v_owner;
    delete from app.tg_links where owner_id = v_owner;
    update app.consents set withdrawn_at = now()
     where owner_id = v_owner and kind = 'tg_login' and withdrawn_at is null;
    perform app.auth_event(v_owner, 'logout_all', null, null, null);
  else
    update app.owner_sessions
       set revoked_at = coalesce(revoked_at, now()),
           revoke_reason = case when revoked_at is null then 'logout' else revoke_reason end,
           grace_cipher = null, grace_expires_at = null
     where owner_id = v_owner and family_id = v_family;
  end if;
  return jsonb_build_object('ok', true);
end
$fn$;

create or replace function public.pd_devices(p_token text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid := app.owner_id(p_token);
  v_family uuid;
  v_user text;
  v_bound timestamptz;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  perform app.session_touch(p_token);
  select family_id into v_family from app.owner_sessions where token_hash = app.hash_token(p_token);
  select tg_username, bound_at into v_user, v_bound from app.tg_links where owner_id = v_owner;
  return jsonb_build_object(
    'telegram', case when v_bound is null then null else jsonb_build_object(
      'username', v_user,
      'bound_at', v_bound,
      'dispute_open', v_bound > now() - interval '24 hours'
    ) end,
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'kind', s.kind,
        'label', coalesce(s.device_label, case when s.kind = 'tg' then 'Telegram' else 'Сайт' end),
        'created_at', s.created_at,
        'last_used_at', s.last_used_at,
        'current', s.family_id = v_family
      ) order by s.created_at desc)
      from app.owner_sessions s
      where s.owner_id = v_owner
        and s.revoked_at is null
        and s.expires_at > now()
        and (s.abs_expires_at is null or s.abs_expires_at > now())
        and (s.kind = 'tg' or s.token_role = 'refresh')
    ), '[]'::jsonb)
  );
end
$fn$;

create or replace function public.pd_device_end(p_token text, p_id uuid, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  v_owner uuid := app.owner_id(p_token);
  s app.owner_sessions;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  select * into s from app.owner_sessions
   where id = p_id and owner_id = v_owner and revoked_at is null
   for update;
  if not found then
    return jsonb_build_object('error', 'Устройство не найдено', 'hint', 'missing');
  end if;
  if s.kind = 'tg' or s.token_role = 'tg' then
    update app.owner_sessions
       set revoked_at = now(), revoke_reason = 'device_end', grace_cipher = null
     where id = s.id;
    delete from app.tg_links where owner_id = v_owner;
    update app.consents set withdrawn_at = now()
     where owner_id = v_owner and kind = 'tg_login' and withdrawn_at is null;
  else
    update app.owner_sessions
       set revoked_at = coalesce(revoked_at, now()),
           revoke_reason = case when revoked_at is null then 'device_end' else revoke_reason end,
           grace_cipher = null
     where family_id = s.family_id and owner_id = v_owner;
  end if;
  perform app.auth_event(v_owner, 'device_end', s.tg_user_id, null, s.device_label);
  return jsonb_build_object('ok', true);
end
$fn$;

create or replace function public.pd_owner_invite_issue(p_note text, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  code text;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  code := rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=');
  insert into app.owner_invites (code_hash, note, expires_at)
  values (app.hash_token(code), left(coalesce(p_note, ''), 120), now() + interval '14 days');
  return jsonb_build_object('code', code, 'expires_at', now() + interval '14 days');
end
$fn$;

create or replace function public.pd_auth_signal(p_status int, p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
declare
  n int;
  sent timestamptz;
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  insert into app.auth_signals (status) values (p_status);
  select count(*) into n from app.auth_signals where at > now() - interval '5 minutes' and status in (401, 429);
  if n > 50 then
    select at into sent from app.auth_alerts where kind = 'spike';
    if sent is null or sent < now() - interval '5 minutes' then
      insert into app.auth_alerts (kind, at) values ('spike', now())
      on conflict (kind) do update set at = now();
      return jsonb_build_object('alert', true, 'n', n);
    end if;
  end if;
  return jsonb_build_object('alert', false, 'n', n);
end
$fn$;

create or replace function public.pd_auth_cleanup(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog
as $fn$
begin
  if not app.secret_ok(p_secret) then
    raise exception 'forbidden' using hint = 'forbidden';
  end if;
  delete from app.tg_initdata_used where expires_at < now();
  delete from app.rate_hits where at < now() - interval '2 days';
  delete from app.login_attempts where at < now() - interval '2 days';
  delete from app.auth_events where at < now() - interval '1 year';
  delete from app.auth_signals where at < now() - interval '2 days';
  update app.owner_sessions
     set grace_cipher = null, grace_expires_at = null
   where grace_expires_at is not null and grace_expires_at < now();
  delete from app.tg_link_codes where expires_at < now() - interval '1 day';
  delete from app.owner_invites where used_at is null and expires_at < now() - interval '1 day';
  return jsonb_build_object('ok', true);
end
$fn$;

-- ---------------------------------------------------------------------------
-- права: публичные RPC кабинета остаются, выдача сессий — только service_role
-- ---------------------------------------------------------------------------

do $do$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'pd_tg_session', 'pd_tg_link', 'pd_tg_login', 'pd_link_code_consume',
         'pd_link_code_issue', 'pd_link_status', 'pd_tg_unbind',
         'pd_web_register', 'pd_web_login', 'pd_web_refresh', 'pd_web_migrate', 'pd_web_logout',
         'pd_devices', 'pd_device_end', 'pd_owner_invite_issue',
         'pd_rate_bump', 'pd_auth_signal', 'pd_auth_cleanup'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end
$do$;

revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all sequences in schema app from public, anon, authenticated;
revoke all on schema app from public;
grant usage on schema app to postgres;
