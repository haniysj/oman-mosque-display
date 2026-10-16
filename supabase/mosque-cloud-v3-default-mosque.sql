-- Oman Mosque Display — update v3: the platform's DEFAULT mosque
-- A device that opens the site for the first time (no mosque chosen yet) links itself to this mosque
-- automatically, so nobody ever sees an empty screen. Adds 1 small table + 2 functions.
-- No changes to existing tables or data. Safe to run more than once. Run AFTER v2.

create table if not exists mosque_private.settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);
revoke all on table mosque_private.settings from public, anon, authenticated;

-- Read the default mosque (anyone): returns {code, name_ar, ...} or null
create or replace function public.mosque_default_get()
returns jsonb language sql security definer set search_path = mosque_private as $$
  select jsonb_build_object('code', m.code, 'name_ar', m.name_ar, 'governorate_id', m.governorate_id, 'wilayat_id', m.wilayat_id)
  from mosque_private.settings s
  join mosque_private.mosques m on m.code = s.value->>'code'
  where s.key = 'default_mosque';
$$;

-- Set / clear the default mosque (admin password required). p_code null → no default.
create or replace function public.mosque_admin_set_default(p_password text, p_code text)
returns boolean language plpgsql security definer set search_path = mosque_private, extensions as $$
begin
  perform mosque_private.assert_admin(p_password);
  if p_code is null or p_code = '' then
    delete from mosque_private.settings where key = 'default_mosque';
    return true;
  end if;
  if not exists (select 1 from mosque_private.mosques where code = p_code) then
    raise exception 'mosque_not_found';
  end if;
  insert into mosque_private.settings(key, value, updated_at) values ('default_mosque', jsonb_build_object('code', p_code), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return true;
end $$;

grant execute on function public.mosque_default_get(), public.mosque_admin_set_default(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
-- ✅ نهاية الملف
