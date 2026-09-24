-- 048: Employee pay approval + days off (fixed weekly, per-day, requests).
--
-- 1. pay_approvals — an employee confirms the days/amount of a pay period
--    ("Approve payment" on the Pay screen). One row per employee per period.
--    The app never deletes or edits a row from the employee side (there is
--    no "undo"); if the amount changes after approving, the employee is
--    asked to approve again and the row is overwritten with the new amount.
--    seen_at is set when an admin opens Payroll, so the Payroll menu item
--    can show how many new approvals arrived.
--
-- 2. profiles.weekly_days_off — fixed weekly days off, as day-of-week
--    numbers (0 = Sunday … 6 = Saturday). Empty = works every day.
--
-- 3. schedule_overrides — one specific date that differs from the fixed
--    schedule: is_off = true gives a day off on a normal work day,
--    is_off = false makes someone work on one of their fixed days off.
--
-- 4. day_off_requests — an employee asks for a day off in the app; the
--    admin approves (which writes a schedule_overrides row) or declines.
--
-- Every table gets the same tenant-isolation policy as migration 040
-- (company_id = the company in the signed-in user's token). No anon policy
-- is created, so these tables are never readable with the public anon key.
--
-- Safe to run multiple times.

-- ── 1. pay_approvals ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pay_approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  employee_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  amount        numeric(12,2) NOT NULL,
  days_worked   numeric(6,2),
  approved_at   timestamptz NOT NULL DEFAULT now(),
  seen_at       timestamptz,
  UNIQUE (company_id, employee_id, period_start, period_end)
);
CREATE INDEX IF NOT EXISTS idx_pay_approvals_period ON pay_approvals(company_id, period_start, period_end);

-- ── 2. fixed weekly days off ─────────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS weekly_days_off smallint[] NOT NULL DEFAULT '{}';

-- ── 3. schedule_overrides ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date        date NOT NULL,
  is_off      boolean NOT NULL,
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, date)
);
CREATE INDEX IF NOT EXISTS idx_schedule_overrides_company_date ON schedule_overrides(company_id, date);

-- ── 4. day_off_requests ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS day_off_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date        date NOT NULL,
  reason      text,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  decided_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_day_off_requests_company_status ON day_off_requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_day_off_requests_employee ON day_off_requests(employee_id, date);

-- ── Row-level security (same policy as migration 040) ────────────────────────
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['pay_approvals', 'schedule_overrides', 'day_off_requests']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', tbl);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_tenant_isolation ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY authenticated_tenant_isolation ON %I FOR ALL TO authenticated USING (company_id = orbit_jwt_company_id()) WITH CHECK (company_id = orbit_jwt_company_id())',
      tbl
    );
  END LOOP;
END $$;

-- PostgREST caches the schema; reload it so the new tables/column are
-- usable right away instead of after the next automatic reload.
NOTIFY pgrst, 'reload schema';
