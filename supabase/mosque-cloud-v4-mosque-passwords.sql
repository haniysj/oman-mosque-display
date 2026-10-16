-- Oman Mosque Display — update v4: a password per mosque (mosque supervisor)
-- • The general administrator password (existing) opens everything.
-- • A mosque password opens only that mosque's settings (iqamah, Friday, display, adhkar…).
-- • Only the general administrator sets / changes / removes mosque passwords.
-- Adds 1 table + 4 functions. No changes to existing tables or data. Safe to run more than once.

create table if not exists mosque_private.mosque_passwords (
  code text primary key references mosque_private.mosques(code) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);
revoke all on table mosque_private.mosque_passwords from public, anon, authenticated;

-- true when p_password is the general administrator password
create or replace function mosque_private.is_super(p_password text)
returns boolean language sql stable security definer set search_path = mosque_private, extensions as $$
  select coalesce((select extensions.crypt(p_password, a.password_hash) = a.password_hash from mosque_private.admin a where a.id = 1), false)
    and p_password is not null;
$$;
revoke all on function mosque_private.is_super(text) from public, anon, authenticated;

-- Sign in: {"role":"super"} or {"role":"mosque","codes":[…]}; wrong password → BAD_PASSWORD
create or replace function public.mosque_auth(p_password text)
returns jsonb language plpgsql security definer set search_path = mosque_private, extensions as $$
declare codes jsonb;
begin
  if p_password is null or p_password = '' then raise exception 'BAD_PASSWORD'; end if;
  if mosque_private.is_super(p_password) then return jsonb_build_object('role', 'super'); end if;
  select coalesce(jsonb_agg(p.code order by p.code), '[]'::jsonb) into codes
  from mosque_private.mosque_passwords p
  where extensions.crypt(p_password, p.password_hash) = p.password_hash;
  if jsonb_array_length(codes) = 0 then raise exception 'BAD_PASSWORD'; end if;
  return jsonb_build_object('role', 'mosque', 'codes', codes);
end $$;

-- Save one mosque's settings (config + optional adhkar). General admin, or that mosque's password.
-- Name / wilayat are not changed here (general administrator only).
create or replace function public.mosque_manager_update(p_password text, p_code text, p_config jsonb, p_adhkar jsonb)
returns jsonb language plpgsql security definer set search_path = mosque_private, extensions as $$
declare v int;
begin
  if not mosque_private.is_super(p_password) and not exists (
    select 1 from mosque_private.mosque_passwords p
    where p.code = p_code and extensions.crypt(p_password, p.password_hash) = p.password_hash
  ) then raise exception 'BAD_PASSWORD'; end if;
  update mosque_private.mosques set
    config = coalesce(p_config, config),
    adhkar = coalesce(p_adhkar, adhkar),
    version = version + 1,
    updated_at = now()
  where code = p_code
  returning version into v;
  if v is null then raise exception 'mosque_not_found'; end if;
  return jsonb_build_object('version', v);
end $$;

-- Set / change / remove (p_new null or '') a mosque password — general administrator only.
create or replace function public.mosque_admin_set_mosque_password(p_password text, p_code text, p_new text)
returns boolean language plpgsql security definer set search_path = mosque_private, extensions as $$
begin
  perform mosque_private.assert_admin(p_password);
  if p_new is null or p_new = '' then
    delete from mosque_private.mosque_passwords where code = p_code;
    return true;
  end if;
  if length(p_new) < 4 then raise exception 'PASSWORD_TOO_SHORT'; end if;
  if not exists (select 1 from mosque_private.mosques where code = p_code) then raise exception 'mosque_not_found'; end if;
  insert into mosque_private.mosque_passwords(code, password_hash, updated_at)
  values (p_code, extensions.crypt(p_new, extensions.gen_salt('bf', 10)), now())
  on conflict (code) do update set password_hash = excluded.password_hash, updated_at = now();
  return true;
end $$;

-- Which mosques have a password (no hashes) — general administrator only.
create or replace function public.mosque_admin_mosque_passwords(p_password text)
returns jsonb language plpgsql security definer set search_path = mosque_private, extensions as $$
begin
  perform mosque_private.assert_admin(p_password);
  return (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'updated_at', updated_at) order by code), '[]'::jsonb) from mosque_private.mosque_passwords);
end $$;

grant execute on function
  public.mosque_auth(text),
  public.mosque_manager_update(text, text, jsonb, jsonb),
  public.mosque_admin_set_mosque_password(text, text, text),
  public.mosque_admin_mosque_passwords(text)
to anon, authenticated;

notify pgrst, 'reload schema';
-- ✅ نهاية الملف
