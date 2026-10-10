-- Oman Mosque Display — update v2: manage each wilayat's timetable on its own
-- Adds 2 functions only (no table changes, no data changes). Safe to run more than once.
-- Run AFTER supabase/mosque-cloud.sql. Does not touch any other table in the project.

-- Read one wilayat's timetable (even if no mosque uses it yet)
create or replace function public.mosque_timetable_get(p_wilayat_id text)
returns jsonb language sql security definer set search_path = mosque_private as $$
  select jsonb_build_object(
    'wilayat_id', t.wilayat_id, 'governorate_id', t.governorate_id, 'schedule', t.schedule,
    'calibration', t.calibration, 'version', t.version, 'updated_at', t.updated_at)
  from mosque_private.timetables t
  where t.wilayat_id = p_wilayat_id;
$$;

-- Delete one wilayat's timetable (admin password required)
create or replace function public.mosque_admin_delete_timetable(p_password text, p_wilayat_id text)
returns boolean language plpgsql security definer set search_path = mosque_private, extensions as $$
begin
  perform mosque_private.assert_admin(p_password);
  delete from mosque_private.timetables where wilayat_id = p_wilayat_id;
  return found;
end $$;

grant execute on function
  public.mosque_timetable_get(text),
  public.mosque_admin_delete_timetable(text, text)
to anon, authenticated;

notify pgrst, 'reload schema';
-- ✅ نهاية الملف
