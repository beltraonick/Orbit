-- ============================================================================
-- Real, database-enforced tenant isolation — Part 1 (additive, non-breaking).
-- ============================================================================
--
-- BACKGROUND: every table in this app has RLS "enabled" but with an
-- `anon_all` policy (USING (true) WITH CHECK (true)) granting the `anon`
-- Postgres role full read/write on every row, because the app doesn't use
-- Supabase Auth — it has its own HMAC-signed session cookie (lib/auth/session.ts)
-- and every Supabase call, from both the browser and Next.js server code,
-- goes out with the public anon key. That means `company_id` filtering has
-- been a pure application-code convention: the database itself has never
-- stopped anyone with the anon key (which is necessarily public — it's
-- embedded in the client bundle) from reading or writing ANY company's data
-- directly via the Supabase REST API, bypassing the app's UI entirely.
--
-- THE FIX: lib/auth/supabase-jwt.ts now mints a real JWT from the verified
-- session (company_id and role as custom claims, `role: authenticated` so
-- PostgREST runs the query as the `authenticated` Postgres role instead of
-- `anon`), attached to every Supabase call from both lib/supabase/server.ts
-- and lib/supabase/client.ts. This migration adds policies for that
-- `authenticated` role, scoped to the claims in that JWT — company_id is
-- verified server-side when the token is minted, never trusted from the
-- browser.
--
-- THIS MIGRATION ONLY ADDS POLICIES. It does not touch the existing
-- `anon_all` policies, so nothing breaks if it's applied before the app
-- code above is deployed, and nothing breaks for anyone still completing a
-- request as `anon` (public pages, or before SUPABASE_JWT_SECRET is set).
-- Tenant isolation is NOT actually enforced until the separate, later
-- migration 044 removes the anon_all policies — that is a deliberate,
-- separate step, run only after this one has been verified. See migration
-- 044's header for the exact order of operations.
--
-- Safe to run multiple times.

-- ── Helper functions ─────────────────────────────────────────────────────────
-- Pure JWT-claim readers — no table lookups, so calling them from a policy
-- can never recurse into that same table's (or any other table's) RLS.
CREATE OR REPLACE FUNCTION orbit_jwt_company_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'app_company_id', '')::uuid
$$;

CREATE OR REPLACE FUNCTION orbit_jwt_role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT current_setting('request.jwt.claims', true)::json->>'app_role'
$$;

GRANT EXECUTE ON FUNCTION orbit_jwt_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION orbit_jwt_role() TO authenticated;

-- ── Generic policy for every table with a direct company_id column ─────────
-- Verified against the actual CREATE TABLE statement for each of these (not
-- assumed) — every one of them has its own `company_id uuid` column.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'ai_conversations',
    'change_orders',
    'company_document_settings',
    'expense_categories',
    'expenses',
    'invite_codes',
    'login_events',
    'manual_compensations',
    'membership_requests',
    'mileage_trips',
    'payroll_period_entries',
    'payroll_periods',
    'payroll_records',
    'plan_markers',
    'plan_sheets',
    'profiles',
    'project_feed',
    'project_photos',
    'project_plans',
    'project_rooms',
    'projects',
    'qbo_connections',
    'qbo_employee_map',
    'qbo_sync_log',
    'receipts',
    'reports',
    'task_columns',
    'task_media',
    'time_entries',
    'vehicles',
    'worker_projects',
    'workers'
  ]
  LOOP
    -- Requires the table to actually have a company_id column, not just to
    -- exist — a table listed here without one (caught once already: `plans`,
    -- a global catalog with no company_id at all) would otherwise abort the
    -- whole loop with "column company_id does not exist" partway through.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl)
       AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'company_id') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', tbl);
      EXECUTE format(
        'DROP POLICY IF EXISTS authenticated_tenant_isolation ON %I', tbl
      );
      EXECUTE format(
        'CREATE POLICY authenticated_tenant_isolation ON %I FOR ALL TO authenticated USING (company_id = orbit_jwt_company_id()) WITH CHECK (company_id = orbit_jwt_company_id())',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- ── plans: the subscription-plan catalog (Starter/Growth) is global, shared
-- reference data — it has no company_id column at all (verified against its
-- actual CREATE TABLE) and was never meant to be tenant-scoped. Every
-- authenticated user can read it; nothing in the app lets a regular
-- authenticated user write to it (owner/company-signup flows use the
-- service role), so no write grant here.
GRANT SELECT ON plans TO authenticated;
DROP POLICY IF EXISTS authenticated_read_plans ON plans;
CREATE POLICY authenticated_read_plans ON plans FOR SELECT TO authenticated USING (true);

-- ── companies: the tenant row itself uses `id`, not `company_id` ───────────
GRANT SELECT, INSERT, UPDATE, DELETE ON companies TO authenticated;
DROP POLICY IF EXISTS authenticated_tenant_isolation ON companies;
CREATE POLICY authenticated_tenant_isolation ON companies FOR ALL TO authenticated
  USING (id = orbit_jwt_company_id()) WITH CHECK (id = orbit_jwt_company_id());

-- ── task_audit_log: referenced by app/(admin)/layout.tsx but has NO
-- migration file anywhere in this repo — it exists in production (if it
-- exists at all) from a change applied directly, outside this migration
-- history. Guarded so this runs safely whether or not the table exists;
-- flagged in the security report for the client to confirm its real schema.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_audit_log')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_audit_log' AND column_name = 'company_id') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON task_audit_log TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS authenticated_tenant_isolation ON task_audit_log';
    EXECUTE 'CREATE POLICY authenticated_tenant_isolation ON task_audit_log FOR ALL TO authenticated USING (company_id = orbit_jwt_company_id()) WITH CHECK (company_id = orbit_jwt_company_id())';
  END IF;
END $$;
