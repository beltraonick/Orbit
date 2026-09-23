-- ============================================================================
-- Real, database-enforced tenant isolation — Part 2: tables without a direct
-- company_id column (additive, non-breaking — see migration 040's header for
-- the full explanation and the deployment order).
-- ============================================================================
-- Safe to run multiple times.

GRANT SELECT, INSERT, UPDATE, DELETE ON tasks, task_assignments, ai_messages, client_activations, project_employees TO authenticated;

-- tasks: scoped via project_id -> projects.company_id. This subquery runs
-- under the SAME authenticated role as the outer query, and projects has its
-- own direct company_id policy (migration 040) — not a recursive reference
-- back into tasks, so this is safe.
DROP POLICY IF EXISTS authenticated_tenant_isolation ON tasks;
CREATE POLICY authenticated_tenant_isolation ON tasks FOR ALL TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE company_id = orbit_jwt_company_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE company_id = orbit_jwt_company_id()));

-- task_assignments: scoped via task_id -> tasks -> project_id -> projects.company_id.
DROP POLICY IF EXISTS authenticated_tenant_isolation ON task_assignments;
CREATE POLICY authenticated_tenant_isolation ON task_assignments FOR ALL TO authenticated
  USING (task_id IN (
    SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE p.company_id = orbit_jwt_company_id()
  ))
  WITH CHECK (task_id IN (
    SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE p.company_id = orbit_jwt_company_id()
  ));

-- ai_messages: scoped via conversation_id -> ai_conversations.company_id.
DROP POLICY IF EXISTS authenticated_tenant_isolation ON ai_messages;
CREATE POLICY authenticated_tenant_isolation ON ai_messages FOR ALL TO authenticated
  USING (conversation_id IN (SELECT id FROM ai_conversations WHERE company_id = orbit_jwt_company_id()))
  WITH CHECK (conversation_id IN (SELECT id FROM ai_conversations WHERE company_id = orbit_jwt_company_id()));

-- client_activations: scoped via profile_id -> profiles.company_id. Used by
-- the admin-facing generateClientActivation() (app/actions/client-activation.ts)
-- to create a one-time activation link for a client in the admin's own
-- company; the not-yet-logged-in redemption half of that flow
-- (activateClientAccount) runs on the service role instead, since there's
-- no session/company to scope by at that point.
DROP POLICY IF EXISTS authenticated_tenant_isolation ON client_activations;
CREATE POLICY authenticated_tenant_isolation ON client_activations FOR ALL TO authenticated
  USING (profile_id IN (SELECT id FROM profiles WHERE company_id = orbit_jwt_company_id()))
  WITH CHECK (profile_id IN (SELECT id FROM profiles WHERE company_id = orbit_jwt_company_id()));

-- project_employees: scoped via project_id -> projects.company_id. Side
-- note found during this audit: this table has had RLS enabled since
-- 001_initial_schema.sql with only the dead Supabase-Auth-era policies
-- (project_employees_select/mutate, dropped in migration 043) — meaning
-- `anon` has had ZERO access to it this whole time (no anon_all policy was
-- ever added for it), independent of anything in this security migration.
-- Whatever feature reads it (app/(employee)/team/extras/page.tsx) has
-- likely been silently getting empty results in production. This policy
-- fixes that as a side effect, once the JWT bridge is live.
DROP POLICY IF EXISTS authenticated_tenant_isolation ON project_employees;
CREATE POLICY authenticated_tenant_isolation ON project_employees FOR ALL TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE company_id = orbit_jwt_company_id()))
  WITH CHECK (project_id IN (SELECT id FROM projects WHERE company_id = orbit_jwt_company_id()));

-- password_resets: deliberately gets NO authenticated policy. Every
-- legitimate access to this table (requesting a reset, redeeming a reset
-- token) happens before a session exists, via the service role
-- (app/actions/password-reset.ts) — nothing in the app ever needs to reach
-- it as `anon` or `authenticated`, so both are denied by default (RLS with
-- no matching policy = no access). This is intentional, not an oversight.
