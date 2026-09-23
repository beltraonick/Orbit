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

DROP POLICY IF EXISTS profiles_select ON profiles;
DROP POLICY IF EXISTS profiles_insert ON profiles;
DROP POLICY IF EXISTS profiles_update ON profiles;
DROP POLICY IF EXISTS profiles_delete ON profiles;

DROP POLICY IF EXISTS projects_select ON projects;
DROP POLICY IF EXISTS projects_insert ON projects;
DROP POLICY IF EXISTS projects_update ON projects;
DROP POLICY IF EXISTS projects_delete ON projects;

DROP POLICY IF EXISTS tasks_select ON tasks;
DROP POLICY IF EXISTS tasks_mutate ON tasks;
DROP POLICY IF EXISTS tasks_employee_update ON tasks;

DROP POLICY IF EXISTS time_entries_select ON time_entries;
DROP POLICY IF EXISTS time_entries_insert ON time_entries;
DROP POLICY IF EXISTS time_entries_update ON time_entries;
DROP POLICY IF EXISTS time_entries_delete ON time_entries;

DROP POLICY IF EXISTS payroll_admin ON payroll_records;

DROP POLICY IF EXISTS photos_select ON project_photos;
DROP POLICY IF EXISTS photos_insert ON project_photos;
DROP POLICY IF EXISTS photos_delete ON project_photos;

DROP POLICY IF EXISTS reports_admin ON reports;
DROP POLICY IF EXISTS company_members ON companies;

DROP POLICY IF EXISTS project_employees_select ON project_employees;
DROP POLICY IF EXISTS project_employees_mutate ON project_employees;

-- These SECURITY DEFINER helpers were only ever called by the policies just
-- dropped above — safe to drop once nothing references them.
DROP FUNCTION IF EXISTS auth_company_id();
DROP FUNCTION IF EXISTS is_admin();
