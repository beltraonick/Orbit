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

DROP POLICY IF EXISTS anon_all ON ai_conversations;
DROP POLICY IF EXISTS anon_all ON ai_messages;
DROP POLICY IF EXISTS anon_all ON change_orders;
DROP POLICY IF EXISTS anon_all ON client_activations;
DROP POLICY IF EXISTS anon_all ON companies;
DROP POLICY IF EXISTS anon_all ON company_document_settings;
DROP POLICY IF EXISTS anon_all ON expense_categories;
DROP POLICY IF EXISTS anon_all ON expenses;
DROP POLICY IF EXISTS anon_all ON invite_codes;
DROP POLICY IF EXISTS anon_all ON login_events;
DROP POLICY IF EXISTS anon_all ON manual_compensations;
DROP POLICY IF EXISTS anon_all ON membership_requests;
DROP POLICY IF EXISTS anon_all ON mileage_trips;
DROP POLICY IF EXISTS anon_all ON password_resets;
DROP POLICY IF EXISTS anon_all ON payroll_period_entries;
DROP POLICY IF EXISTS anon_all ON payroll_periods;
DROP POLICY IF EXISTS anon_all ON payroll_records;
DROP POLICY IF EXISTS anon_all ON plan_markers;
DROP POLICY IF EXISTS anon_all ON plan_sheets;
DROP POLICY IF EXISTS anon_all ON plans;
DROP POLICY IF EXISTS anon_all ON profiles;
DROP POLICY IF EXISTS anon_all ON project_feed;
DROP POLICY IF EXISTS anon_all ON project_photos;
DROP POLICY IF EXISTS anon_all ON project_plans;
DROP POLICY IF EXISTS anon_all ON project_rooms;
DROP POLICY IF EXISTS anon_all ON projects;
DROP POLICY IF EXISTS anon_all ON qbo_connections;
DROP POLICY IF EXISTS anon_all ON qbo_employee_map;
DROP POLICY IF EXISTS anon_all ON qbo_sync_log;
DROP POLICY IF EXISTS anon_all ON receipts;
DROP POLICY IF EXISTS anon_all ON reports;
DROP POLICY IF EXISTS anon_all ON task_assignments;
DROP POLICY IF EXISTS anon_all ON task_media;
DROP POLICY IF EXISTS anon_all ON tasks;
DROP POLICY IF EXISTS anon_all ON time_entries;
DROP POLICY IF EXISTS anon_all ON vehicles;
DROP POLICY IF EXISTS anon_all ON worker_projects;
DROP POLICY IF EXISTS anon_all ON workers;
DROP POLICY IF EXISTS anon_all_task_columns ON task_columns;

-- task_audit_log has no migration file in this repo (see 040's note) — its
-- anon policy, if any, has whatever name was used when it was created
-- directly against the database. Confirm and drop it manually:
--   SELECT policyname FROM pg_policies WHERE tablename = 'task_audit_log';
--   DROP POLICY "<name>" ON task_audit_log;

DROP POLICY IF EXISTS anon_all_project_photos ON storage.objects;
DROP POLICY IF EXISTS anon_all_task_photos ON storage.objects;
DROP POLICY IF EXISTS anon_all_plans ON storage.objects;
DROP POLICY IF EXISTS anon_all_receipts ON storage.objects;
-- Storage reads stay public (see migration 042's note — public buckets +
-- inconsistent historical paths mean this is a separate, larger follow-up).
