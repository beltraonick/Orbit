-- ============================================================================
-- Cleanup: drop dead Supabase-Auth-era RLS policies left over from
-- 001_initial_schema.sql, from before this app switched to its own custom
-- session system at 002_schema_standalone_auth.sql.
-- ============================================================================
--
-- These policies (profiles_select, payroll_admin, tasks_mutate, etc.) call
-- auth.uid() / is_admin() / auth_company_id() — helpers that only make sense
-- if Supabase Auth is issuing the JWT, which it never has been since
-- migration 002 (comment right in that file: "autenticação é feita via JWT
-- cookie próprio, não Supabase Auth"). Since 002, every request has run as
-- `anon`, for which these auth.uid()-based policies always evaluate to
-- false/null — they've been inert dead weight the entire time, superseded
-- immediately by that same migration's anon_all policies.
--
-- They're safe to drop independently of the anon_all cutover (migration
-- 044): dropping a policy that has never granted anything removes nothing
-- that's actually in use. This is cleanup, not a behavior change — but it's
-- still done as its own step (not folded into 040/041) so it's easy to
-- verify in isolation before the higher-stakes cutover migration runs.
--
-- Run this AFTER 040 and 041 (harmless before them too, but there's no
-- reason to run it earlier). Safe to run multiple times.
--
-- `DROP POLICY IF EXISTS x ON t` still errors if table `t` itself doesn't
-- exist — production has already been found to be missing tables this
-- migration history assumed existed (e.g. project_employees) — so every
-- drop here is guarded by a table-existence check instead of assuming the
-- full table list from the migration history is actually present.

DO $$
DECLARE
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['profiles_select', 'profiles'],
    ARRAY['profiles_insert', 'profiles'],
    ARRAY['profiles_update', 'profiles'],
    ARRAY['profiles_delete', 'profiles'],
    ARRAY['projects_select', 'projects'],
    ARRAY['projects_insert', 'projects'],
    ARRAY['projects_update', 'projects'],
    ARRAY['projects_delete', 'projects'],
    ARRAY['tasks_select', 'tasks'],
    ARRAY['tasks_mutate', 'tasks'],
    ARRAY['tasks_employee_update', 'tasks'],
    ARRAY['time_entries_select', 'time_entries'],
    ARRAY['time_entries_insert', 'time_entries'],
    ARRAY['time_entries_update', 'time_entries'],
    ARRAY['time_entries_delete', 'time_entries'],
    ARRAY['payroll_admin', 'payroll_records'],
    ARRAY['photos_select', 'project_photos'],
    ARRAY['photos_insert', 'project_photos'],
    ARRAY['photos_delete', 'project_photos'],
    ARRAY['reports_admin', 'reports'],
    ARRAY['company_members', 'companies'],
    ARRAY['project_employees_select', 'project_employees'],
    ARRAY['project_employees_mutate', 'project_employees']
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = pair[2]) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pair[1], pair[2]);
    END IF;
  END LOOP;
END $$;

-- These SECURITY DEFINER helpers were only ever called by the policies just
-- dropped above — safe to drop once nothing references them.
DROP FUNCTION IF EXISTS auth_company_id();
DROP FUNCTION IF EXISTS is_admin();
