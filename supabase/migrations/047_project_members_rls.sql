-- ============================================================================
-- Real, database-enforced tenant isolation — project_members.
-- ============================================================================
--
-- `project_employees` in 001_initial_schema.sql (and in migrations 040/041/
-- 043/044) was never actually the table in production. The real table —
-- used throughout the app (app/actions/employeeTasks.ts, workerActions.ts,
-- app/(employee)/projects/*, app/(admin)/admin/employees/page.tsx) — is
-- `project_members` (project_id, profile_id), created directly against the
-- database outside this migration history, like task_audit_log. It has
-- never received an `authenticated`-role policy in this security work
-- because it was never known by its real name until now (see PR that fixed
-- Task Report and Team > Extras reading the wrong table).
--
-- Scoped the same way 041 scopes project_employees: via project_id ->
-- projects.company_id. Guarded by table/column existence, safe to run
-- multiple times, does not touch any existing anon policy on this table.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'project_members')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'project_members' AND column_name = 'project_id') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON project_members TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS authenticated_tenant_isolation ON project_members';
    EXECUTE 'CREATE POLICY authenticated_tenant_isolation ON project_members FOR ALL TO authenticated
      USING (project_id IN (SELECT id FROM projects WHERE company_id = orbit_jwt_company_id()))
      WITH CHECK (project_id IN (SELECT id FROM projects WHERE company_id = orbit_jwt_company_id()))';
  END IF;
END $$;
