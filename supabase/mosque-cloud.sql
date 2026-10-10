-- Oman Mosque Display — optional cloud sync (multi-mosque, per-wilayat timetables)
-- Safe to run more than once. Tables live in a private schema that anon cannot touch;
-- all access goes through public.mosque_* SECURITY DEFINER functions.

create schema if not exists mosque_private;
revoke all on schema mosque_private from public, anon, authenticated;

create table if not exists mosque_private.admin (
  id int primary key default 1 check (id = 1),
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists mosque_private.timetables (
  wilayat_id text primary key check (wilayat_id ~ '^[a-z0-9-]{2,40}$'),
  governorate_id text not null,
  schedule jsonb not null,
  calibration jsonb,
  version int not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists mosque_private.mosques (
  code text primary key check (code ~ '^[a-z0-9-]{3,40}$'),
  name_ar text not null check (length(name_ar) between 2 and 120),
  governorate_id text not null,
  wilayat_id text not null,
  config jsonb,
  adhkar jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mosques_wilayat_idx on mosque_private.mosques (wilayat_id);

-- ---------------------------------------------------------------- helpers
create or replace function mosque_private.assert_admin(p_password text)
returns void language plpgsql security definer set search_path = mosque_private, extensions as $$
declare h text;
begin
  select password_hash into h from mosque_private.admin where id = 1;
  if h is null then raise exception 'ADMIN_NOT_INITIALIZED'; end if;
  if p_password is null or extensions.crypt(p_password, h) <> h then raise exception 'BAD_PASSWORD'; end if;
end $$;
revoke all on function mosque_private.assert_admin(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- admin password
create or replace function public.mosque_admin_status()
returns jsonb language sql security definer set search_path = mosque_private as $$
  select jsonb_build_object('initialized', exists(select 1 from mosque_private.admin where id = 1));
$$;

create or replace function public.mosque_admin_init(p_password text)
returns boolean language plpgsql security definer set search_path = mosque_private, extensions as $$
begin
  if exists(select 1 from mosque_private.admin where id = 1) then raise exception 'ALREADY_INITIALIZED'; end if;
  if p_password is null or length(p_password) < 6 then raise exception 'PASSWORD_TOO_SHORT'; end if;
  insert into mosque_private.admin(id, password_hash) values (1, extensions.crypt(p_password, extensions.gen_salt('bf', 10)));
  return true;
end $$;

create or replace function public.mosque_admin_login(p_password text)
returns boolean language plpgsql security definer set search_path = mosque_private, extensions as $$
begin
  perform mosque_private.assert_admin(p_password);
  return true;
end $$;

create or replace function public.mosque_admin_change_password(p_old text, p_new text)
returns boolean language plpgsql security definer set search_path = mosque_private, extensions as $$
begin
  perform mosque_private.assert_admin(p_old);
  if p_new is null or length(p_new) < 6 then raise exception 'PASSWORD_TOO_SHORT'; end if;
  update mosque_private.admin set password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now() where id = 1;
  return true;
end $$;

-- ---------------------------------------------------------------- public reads (display devices)
create or replace function public.mosque_list()
returns jsonb language sql security definer set search_path = mosque_private as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', m.code, 'name_ar', m.name_ar, 'governorate_id', m.governorate_id, 'wilayat_id', m.wilayat_id,
    'version', m.version, 'updated_at', m.updated_at,
    'timetable_version', t.version, 'timetable_days', case when t.schedule is null then 0 else (select count(*) from jsonb_object_keys(t.schedule->'days')) end
  ) order by m.governorate_id, m.wilayat_id, m.name_ar), '[]'::jsonb)
  from mosque_private.mosques m left join mosque_private.timetables t on t.wilayat_id = m.wilayat_id;
$$;

create or replace function public.mosque_versions(p_code text)
returns jsonb language sql security definer set search_path = mosque_private as $$
  select jsonb_build_object('mosque_version', m.version, 'wilayat_id', m.wilayat_id, 'timetable_version', t.version)
  from mosque_private.mosques m left join mosque_private.timetables t on t.wilayat_id = m.wilayat_id
  where m.code = p_code;
$$;

create or replace function public.mosque_bundle(p_code text)
returns jsonb language sql security definer set search_path = mosque_private as $$
  select jsonb_build_object(
    'mosque', jsonb_build_object('code', m.code, 'name_ar', m.name_ar, 'governorate_id', m.governorate_id, 'wilayat_id', m.wilayat_id,
                                 'config', m.config, 'adhkar', m.adhkar, 'version', m.version, 'updated_at', m.updated_at),
    'timetable', case when t.wilayat_id is null then null else jsonb_build_object(
                   'wilayat_id', t.wilayat_id, 'governorate_id', t.governorate_id, 'schedule', t.schedule,
                   'calibration', t.calibration, 'version', t.version, 'updated_at', t.updated_at) end)
  from mosque_private.mosques m left join mosque_private.timetables t on t.wilayat_id = m.wilayat_id
  where m.code = p_code;
$$;

create or replace function public.mosque_timetables_summary()
returns jsonb language sql security definer set search_path = mosque_private as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'wilayat_id', wilayat_id, 'governorate_id', governorate_id, 'version', version, 'updated_at', updated_at,
    'days', (select count(*) from jsonb_object_keys(schedule->'days')),
    'calibrated', calibration is not null,
    'mosques', (select count(*) from mosque_private.mosques m where m.wilayat_id = t.wilayat_id)
  ) order by governorate_id, wilayat_id), '[]'::jsonb)
  from mosque_private.timetables t;
$$;

-- ---------------------------------------------------------------- admin writes
create or replace function public.mosque_admin_upsert_mosque(
  p_password text, p_code text, p_name_ar text, p_governorate_id text, p_wilayat_id text, p_config jsonb, p_adhkar jsonb)
returns jsonb language plpgsql security definer set search_path = mosque_private, extensions as $$
declare v int;
begin
  perform mosque_private.assert_admin(p_password);
  insert into mosque_private.mosques(code, name_ar, governorate_id, wilayat_id, config, adhkar)
  values (lower(p_code), p_name_ar, p_governorate_id, p_wilayat_id, p_config, p_adhkar)
  on conflict (code) do update set
    name_ar = excluded.name_ar,
    governorate_id = excluded.governorate_id,
    wilayat_id = excluded.wilayat_id,
    config = coalesce(excluded.config, mosque_private.mosques.config),
    adhkar = coalesce(excluded.adhkar, mosque_private.mosques.adhkar),
    version = mosque_private.mosques.version + 1,
    updated_at = now()
  returning version into v;
  return jsonb_build_object('version', v);
end $$;

create or replace function public.mosque_admin_delete_mosque(p_password text, p_code text)
returns boolean language plpgsql security definer set search_path = mosque_private, extensions as $$
begin
  perform mosque_private.assert_admin(p_password);
  delete from mosque_private.mosques where code = p_code;
  return found;
end $$;

create or replace function public.mosque_admin_upsert_timetable(
  p_password text, p_wilayat_id text, p_governorate_id text, p_schedule jsonb, p_calibration jsonb)
returns jsonb language plpgsql security definer set search_path = mosque_private, extensions as $$
declare v int;
begin
  perform mosque_private.assert_admin(p_password);
  if p_schedule is null or jsonb_typeof(p_schedule->'days') <> 'object' then raise exception 'BAD_SCHEDULE'; end if;
  insert into mosque_private.timetables(wilayat_id, governorate_id, schedule, calibration)
  values (p_wilayat_id, p_governorate_id, p_schedule, p_calibration)
  on conflict (wilayat_id) do update set
    governorate_id = excluded.governorate_id,
    schedule = excluded.schedule,
    calibration = excluded.calibration,
    version = mosque_private.timetables.version + 1,
    updated_at = now()
  returning version into v;
  return jsonb_build_object('version', v);
end $$;

-- ---------------------------------------------------------------- grants
grant execute on function
  public.mosque_admin_status(), public.mosque_admin_init(text), public.mosque_admin_login(text),
  public.mosque_admin_change_password(text, text), public.mosque_list(), public.mosque_versions(text),
  public.mosque_bundle(text), public.mosque_timetables_summary(),
  public.mosque_admin_upsert_mosque(text, text, text, text, text, jsonb, jsonb),
  public.mosque_admin_delete_mosque(text, text),
  public.mosque_admin_upsert_timetable(text, text, text, jsonb, jsonb)
to anon, authenticated;

notify pgrst, 'reload schema';
-- ✅ نهاية الملف
