-- v5: sign-in sessions (stay signed in after a page reload).
-- A successful sign-in returns a random session token (only its SHA-256 is stored here, valid 12 h).
-- The token is accepted wherever the password was (p_password), with the same role / mosques.
-- The real password is still required to change the general administrator's password.

create table if not exists mosque_private.sessions (
  token_hash text primary key,
  role text not null check (role in ('super', 'mosque')),
  codes text[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table mosque_private.sessions enable row level security;

create or replace function mosque_private.session_row(p_token text)
returns mosque_private.sessions language sql stable security definer
set search_path to 'mosque_private', 'extensions' as $$
  select s.* from mosque_private.sessions s
  where p_token like 'omds\_%' and s.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and s.expires_at > now()
$$;

-- general administrator: password OR a valid super session
create or replace function mosque_private.is_super(p_password text)
returns boolean language sql stable security definer
set search_path to 'mosque_private', 'extensions' as $$
  select p_password is not null and (
    (p_password like 'omds\_%' and coalesce((select r.role = 'super' from mosque_private.session_row(p_password) r where r.token_hash is not null), false))
    or coalesce((select extensions.crypt(p_password, a.password_hash) = a.password_hash from mosque_private.admin a where a.id = 1), false)
  )
$$;

create or replace function mosque_private.assert_admin(p_password text)
returns void language plpgsql security definer
set search_path to 'mosque_private', 'extensions' as $$
declare h text;
begin
  select password_hash into h from mosque_private.admin where id = 1;
  if h is null then raise exception 'ADMIN_NOT_INITIALIZED'; end if;
  if not mosque_private.is_super(p_password) then raise exception 'BAD_PASSWORD'; end if;
end $$;

-- the mosques a password or a session may edit
create or replace function mosque_private.mosque_codes_for(p_password text)
returns text[] language plpgsql stable security definer
set search_path to 'mosque_private', 'extensions' as $$
declare r mosque_private.sessions;
begin
  if p_password is null or p_password = '' then return '{}'; end if;
  if p_password like 'omds\_%' then
    select * into r from mosque_private.session_row(p_password);
    if r.token_hash is not null and r.role = 'mosque' then return r.codes; end if;
    return '{}';
  end if;
  return coalesce((select array_agg(p.code order by p.code) from mosque_private.mosque_passwords p
                   where extensions.crypt(p_password, p.password_hash) = p.password_hash), '{}');
end $$;

create or replace function public.mosque_auth(p_password text)
returns jsonb language plpgsql security definer
set search_path to 'mosque_private', 'extensions' as $$
declare codes text[];
begin
  if p_password is null or p_password = '' then raise exception 'BAD_PASSWORD'; end if;
  if mosque_private.is_super(p_password) then return jsonb_build_object('role', 'super'); end if;
  codes := mosque_private.mosque_codes_for(p_password);
  if coalesce(array_length(codes, 1), 0) = 0 then raise exception 'BAD_PASSWORD'; end if;
  return jsonb_build_object('role', 'mosque', 'codes', to_jsonb(codes));
end $$;

create or replace function public.mosque_manager_update(p_password text, p_code text, p_config jsonb, p_adhkar jsonb)
returns jsonb language plpgsql security definer
set search_path to 'mosque_private', 'extensions' as $$
declare v int;
begin
  if not mosque_private.is_super(p_password) and not (p_code = any(mosque_private.mosque_codes_for(p_password))) then
    raise exception 'BAD_PASSWORD';
  end if;
  update mosque_private.mosques set config = coalesce(p_config, config), adhkar = coalesce(p_adhkar, adhkar),
    version = version + 1, updated_at = now()
  where code = p_code returning version into v;
  if v is null then raise exception 'mosque_not_found'; end if;
  return jsonb_build_object('version', v);
end $$;

-- start a session with the real password (never with another session)
create or replace function public.mosque_session_start(p_password text)
returns jsonb language plpgsql security definer
set search_path to 'mosque_private', 'extensions' as $$
declare a jsonb; tok text; exp timestamptz := now() + interval '12 hours';
begin
  if p_password is null or p_password like 'omds\_%' then raise exception 'BAD_PASSWORD'; end if;
  a := public.mosque_auth(p_password);
  tok := 'omds_' || encode(extensions.gen_random_bytes(32), 'hex');
  delete from mosque_private.sessions where expires_at < now();
  insert into mosque_private.sessions (token_hash, role, codes, expires_at)
  values (encode(extensions.digest(tok, 'sha256'), 'hex'), a->>'role',
          coalesce((select array_agg(x) from jsonb_array_elements_text(a->'codes') x), '{}'), exp);
  return a || jsonb_build_object('token', tok, 'expires_at', exp);
end $$;

create or replace function public.mosque_session_end(p_token text)
returns boolean language sql security definer
set search_path to 'mosque_private', 'extensions' as $$
  delete from mosque_private.sessions where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') returning true
$$;

-- changing the general administrator's password needs the real current password, and ends all super sessions
create or replace function public.mosque_admin_change_password(p_old text, p_new text)
returns boolean language plpgsql security definer
set search_path to 'mosque_private', 'extensions' as $$
declare h text;
begin
  select password_hash into h from mosque_private.admin where id = 1;
  if h is null then raise exception 'ADMIN_NOT_INITIALIZED'; end if;
  if p_old is null or p_old like 'omds\_%' or extensions.crypt(p_old, h) <> h then raise exception 'BAD_PASSWORD'; end if;
  if p_new is null or length(p_new) < 6 then raise exception 'PASSWORD_TOO_SHORT'; end if;
  update mosque_private.admin set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now() where id = 1;
  delete from mosque_private.sessions where role = 'super';
  return true;
end $$;

grant execute on function public.mosque_session_start(text), public.mosque_session_end(text) to anon, authenticated;

-- a mosque's password changed or removed → its supervisors' sessions end
create or replace function mosque_private.end_mosque_sessions() returns trigger language plpgsql security definer
set search_path to 'mosque_private' as $$
begin
  delete from mosque_private.sessions where role = 'mosque' and (old.code = any(codes));
  return null;
end $$;
drop trigger if exists mosque_passwords_end_sessions on mosque_private.mosque_passwords;
create trigger mosque_passwords_end_sessions after update or delete on mosque_private.mosque_passwords
  for each row execute function mosque_private.end_mosque_sessions();
