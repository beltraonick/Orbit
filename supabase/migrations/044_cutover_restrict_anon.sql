-- ============================================================================
-- CUTOVER — this is the step that actually makes tenant isolation real.
-- ============================================================================
--
-- DO NOT RUN THIS until ALL of the following are true:
--   1. Migrations 040, 041, 042, 043 have been applied successfully.
--   2. SUPABASE_JWT_SECRET is set in the app's production environment to
--      this Supabase project's actual JWT secret (Dashboard -> Project
--      Settings -> API -> JWT Settings -> "Legacy JWT Secret").
--   3. SUPABASE_SERVICE_ROLE_KEY is set in the app's production environment
--      (same page, "service_role secret").
--   4. The app has been REDEPLOYED with the code changes that mint and
--      attach that JWT (lib/supabase/server.ts, lib/supabase/client.ts,
--      components/SupabaseAuthBridge.tsx) and that move login/signup/
--      invite-acceptance/password-reset/client-activation/owner actions to
--      the service role (lib/auth/store.ts, app/actions/password-reset.ts,
--      app/actions/client-activation.ts, app/actions/company-signup.ts,
--      app/actions/owner.ts).
--   5. You have run the FULL regression checklist from the security report
--      against that deployment — every item, not a sample — including
--      login, registration via invite code, password reset, client
--      activation, employee dashboard, admin dashboard, time entries,
--      payroll (including Finalize Payroll and Manual Compensation),
--      reports/XLSX, expenses, mileage, photo uploads, and owner actions
--      (including impersonation).
--   6. You have run the Company A / Company B attack tests from the
--      security report against a STAGING project first, not production.
--
-- Once this runs, `anon` loses all access to every tenant-owned table.
-- Anything the app still tries to do as `anon` (i.e. anything that should
-- have been migrated to the JWT bridge or the service role in step 4 but
-- was missed) will start failing immediately and visibly for every user —
-- there is no gradual rollout here. If that happens: the fastest safe
-- rollback is re-running the old anon_all CREATE POLICY statements from the
-- original migration files (002, 003, 007, 012, 015, 016, 022, 023, 024,
-- 027, 028, 029, 032, 038, 039) to restore access while you fix the missed
-- call site, rather than trying to debug forward under pressure.
--
-- This migration is intentionally its own file, never bundled with 040-043,
-- so it can never run by accident as part of a routine "apply all pending
-- migrations" pass.

-- `DROP POLICY IF EXISTS x ON t` still errors if table `t` itself doesn't
-- exist — production has already been found to be missing tables this
-- migration history assumed existed (e.g. project_employees), so every drop
-- below is guarded by a table-existence check.
DO $$
DECLARE
  pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ARRAY['anon_all', 'ai_conversations'],
    ARRAY['anon_all', 'ai_messages'],
    ARRAY['anon_all', 'change_orders'],
    ARRAY['anon_all', 'client_activations'],
    ARRAY['anon_all', 'companies'],
    ARRAY['anon_all', 'company_document_settings'],
    ARRAY['anon_all', 'expense_categories'],
    ARRAY['anon_all', 'expenses'],
    ARRAY['anon_all', 'invite_codes'],
    ARRAY['anon_all', 'login_events'],
    ARRAY['anon_all', 'manual_compensations'],
    ARRAY['anon_all', 'membership_requests'],
    ARRAY['anon_all', 'mileage_trips'],
    ARRAY['anon_all', 'password_resets'],
    ARRAY['anon_all', 'payroll_period_entries'],
    ARRAY['anon_all', 'payroll_periods'],
    ARRAY['anon_all', 'payroll_records'],
    ARRAY['anon_all', 'plan_markers'],
    ARRAY['anon_all', 'plan_sheets'],
    ARRAY['anon_all', 'plans'],
    ARRAY['anon_all', 'profiles'],
    ARRAY['anon_all', 'project_feed'],
    ARRAY['anon_all', 'project_photos'],
    ARRAY['anon_all', 'project_plans'],
    ARRAY['anon_all', 'project_rooms'],
    ARRAY['anon_all', 'projects'],
    ARRAY['anon_all', 'qbo_connections'],
    ARRAY['anon_all', 'qbo_employee_map'],
    ARRAY['anon_all', 'qbo_sync_log'],
    ARRAY['anon_all', 'receipts'],
    ARRAY['anon_all', 'reports'],
    ARRAY['anon_all', 'task_assignments'],
    ARRAY['anon_all', 'task_media'],
    ARRAY['anon_all', 'tasks'],
    ARRAY['anon_all', 'time_entries'],
    ARRAY['anon_all', 'vehicles'],
    ARRAY['anon_all', 'worker_projects'],
    ARRAY['anon_all', 'workers'],
    ARRAY['anon_all_task_columns', 'task_columns']
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = pair[2]) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pair[1], pair[2]);
    END IF;
  END LOOP;
END $$;

-- task_audit_log and project_members both have no migration file in this
-- repo (see 040/047's notes) — whatever anon policy each has, if any, has
-- whatever name was used when it was created directly against the
-- database. Confirm and drop it manually for each:
--   SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('task_audit_log', 'project_members');
--   DROP POLICY "<name>" ON <table>;

DROP POLICY IF EXISTS anon_all_project_photos ON storage.objects;
DROP POLICY IF EXISTS anon_all_task_photos ON storage.objects;
DROP POLICY IF EXISTS anon_all_plans ON storage.objects;
DROP POLICY IF EXISTS anon_all_receipts ON storage.objects;
-- Storage reads stay public (see migration 042's note — public buckets +
-- inconsistent historical paths mean this is a separate, larger follow-up).
