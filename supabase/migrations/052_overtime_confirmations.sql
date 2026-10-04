-- Overtime confirmation: once an employee is clocked in past the company's
-- normal end-of-day, the app asks "still working?" instead of silently
-- assuming either way. Saying yes logs a timestamped, location-checked
-- confirmation (visible to admins); saying no clocks them out immediately.
-- The existing clock_out_deadline (see 033_clock_window_settings.sql)
-- becomes the hard ceiling: past it, nobody is asked anymore — the sweep
-- (lib/auto-clockout.ts) just closes the entry, no exceptions.
--
-- normal_clock_out_time is a NEW, separate time from clock_out_deadline:
-- before this migration, clock_out_deadline served both as "when the normal
-- day ends" and "the hard auto-close ceiling" — a company that wants real
-- overtime paid needs these to be different times (e.g. normal end 18:00,
-- hard ceiling 22:00), or the hard ceiling would cut off real overtime.
-- Backfills from the company's current clock_out_deadline, so nothing
-- changes in behavior until an admin deliberately sets a later deadline.

ALTER TABLE company_document_settings
  ADD COLUMN IF NOT EXISTS normal_clock_out_time text;

UPDATE company_document_settings
  SET normal_clock_out_time = clock_out_deadline
  WHERE normal_clock_out_time IS NULL;

ALTER TABLE company_document_settings
  ALTER COLUMN normal_clock_out_time SET DEFAULT '18:00',
  ALTER COLUMN normal_clock_out_time SET NOT NULL;

CREATE TABLE IF NOT EXISTS overtime_confirmations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  employee_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  time_entry_id  uuid NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  confirmed_at   timestamptz NOT NULL DEFAULT now(),
  latitude       double precision,
  longitude      double precision,
  within_job_site boolean,
  job_site_name  text
);
CREATE INDEX IF NOT EXISTS idx_overtime_confirmations_entry ON overtime_confirmations(time_entry_id);
CREATE INDEX IF NOT EXISTS idx_overtime_confirmations_company_date ON overtime_confirmations(company_id, confirmed_at);

-- Row-level security (same policy as migration 040/048).
DO $$
BEGIN
  EXECUTE 'ALTER TABLE overtime_confirmations ENABLE ROW LEVEL SECURITY';
  EXECUTE 'GRANT SELECT, INSERT ON overtime_confirmations TO authenticated';
  EXECUTE 'DROP POLICY IF EXISTS authenticated_tenant_isolation ON overtime_confirmations';
  EXECUTE 'CREATE POLICY authenticated_tenant_isolation ON overtime_confirmations FOR ALL TO authenticated USING (company_id = orbit_jwt_company_id()) WITH CHECK (company_id = orbit_jwt_company_id())';
END $$;

NOTIFY pgrst, 'reload schema';
