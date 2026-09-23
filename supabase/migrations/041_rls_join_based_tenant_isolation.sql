-- ============================================================================
-- Real, database-enforced tenant isolation — Part 2: tables without a direct
-- company_id column (additive, non-breaking — see migration 040's header for
-- the full explanation and the deployment order).
-- ============================================================================
-- Safe to run multiple times. Every block below is guarded by a table
-- existence check — production has already been found to be missing tables
-- this history assumed existed (e.g. project_employees), so nothing here
-- runs against a table that isn't actually there.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tasks') THEN
    -- tasks: scoped via project_id -> projects.company_id. This subquery runs
    -- under the SAME authenticated role as the outer query, and projects has
    -- its own direct company_id policy (migration 040) — not a recursive
    -- reference back into tasks, so this is safe.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON tasks TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS authenticated_tenant_isolation ON tasks';
    EXECUTE 'CREATE POLICY authenticated_tenant_isolation ON tasks FOR ALL TO authenticated
      USING (project_id IN (SELECT id FROM projects WHERE company_id = orbit_jwt_company_id()))
      WITH CHECK (project_id IN (SELECT id FROM projects WHERE company_id = orbit_jwt_company_id()))';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_assignments') THEN
    -- task_assignments: scoped via task_id -> tasks -> project_id -> projects.company_id.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON task_assignments TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS authenticated_tenant_isolation ON task_assignments';
    EXECUTE 'CREATE POLICY authenticated_tenant_isolation ON task_assignments FOR ALL TO authenticated
      USING (task_id IN (
        SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE p.company_id = orbit_jwt_company_id()
      ))
      WITH CHECK (task_id IN (
        SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE p.company_id = orbit_jwt_company_id()
      ))';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_messages') THEN
    -- ai_messages: scoped via conversation_id -> ai_conversations.company_id.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ai_messages TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS authenticated_tenant_isolation ON ai_messages';
    EXECUTE 'CREATE POLICY authenticated_tenant_isolation ON ai_messages FOR ALL TO authenticated
      USING (conversation_id IN (SELECT id FROM ai_conversations WHERE company_id = orbit_jwt_company_id()))
      WITH CHECK (conversation_id IN (SELECT id FROM ai_conversations WHERE company_id = orbit_jwt_company_id()))';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'client_activations') THEN
    -- client_activations: scoped via profile_id -> profiles.company_id. Used
    -- by the admin-facing generateClientActivation() (app/actions/client-activation.ts)
    -- to create a one-time activation link for a client in the admin's own
    -- company; the not-yet-logged-in redemption half of that flow
    -- (activateClientAccount) runs on the service role instead, since there's
    -- no session/company to scope by at that point.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON client_activations TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS authenticated_tenant_isolation ON client_activations';
    EXECUTE 'CREATE POLICY authenticated_tenant_isolation ON client_activations FOR ALL TO authenticated
      USING (profile_id IN (SELECT id FROM profiles WHERE company_id = orbit_jwt_company_id()))
      WITH CHECK (profile_id IN (SELECT id FROM profiles WHERE company_id = orbit_jwt_company_id()))';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'project_employees') THEN
    -- project_employees: scoped via project_id -> projects.company_id. Not
    -- present in every deployment of this schema (confirmed against real
    -- production) — guarded like every other block here.
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON project_employees TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS authenticated_tenant_isolation ON project_employees';
    EXECUTE 'CREATE POLICY authenticated_tenant_isolation ON project_employees FOR ALL TO authenticated
      USING (project_id IN (SELECT id FROM projects WHERE company_id = orbit_jwt_company_id()))
      WITH CHECK (project_id IN (SELECT id FROM projects WHERE company_id = orbit_jwt_company_id()))';
  END IF;
END $$;

-- password_resets: deliberately gets NO authenticated policy. Every
-- legitimate access to this table (requesting a reset, redeeming a reset
-- token) happens before a session exists, via the service role
-- (app/actions/password-reset.ts) — nothing in the app ever needs to reach
-- it as `anon` or `authenticated`, so both are denied by default (RLS with
-- no matching policy = no access). This is intentional, not an oversight.
