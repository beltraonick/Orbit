-- STEP1_APPLY_037_company_pay_system.sql
-- Deployment wrapper for supabase/migrations/037_company_pay_system.sql (current main).
-- Everything between the BEGIN and COMMIT lines is byte-identical to that file.
-- BEGIN/COMMIT make it all-or-nothing: if any statement errors, nothing is applied.
-- Safe to re-run (every statement is IF NOT EXISTS / NULL-only / idempotent).

BEGIN;

-- Organization-level Pay System (Daily vs Hourly).
--
-- The company's Pay System governs HOW normal compensation is calculated and
-- what terminology/UI the app shows (Days Worked vs Hours Worked, etc). The
-- actual RATE stays per-person (profiles.daily_rate/hourly_rate,
-- workers.daily_rate/hourly_rate) exactly as today — this migration does not
-- touch or move any rate data.
--
-- pay_system is nullable and starts unset for every company. It is only
-- auto-filled below when a company's EXISTING employee/worker data
-- unambiguously supports one mode (every active person's populated rate
-- field agrees). Any company with mixed or empty rate data is left NULL —
-- the app keeps behaving exactly as it does today for those companies
-- (calcEntryPay's existing per-person daily_rate-wins heuristic) until an
-- admin explicitly picks a Pay System in Settings. This migration never
-- guesses and never rewrites a rate value.
--
-- Run this in the Supabase SQL editor. The RAISE NOTICE lines below print a
-- per-company breakdown (daily count / hourly count / total / decision) to
-- the query log so you can see exactly what was detected before trusting the
-- result — check that log after running.

ALTER TABLE company_document_settings
  ADD COLUMN IF NOT EXISTS pay_system text
    CHECK (pay_system IN ('daily', 'hourly'));

-- Ensure every company has a company_document_settings row to hold this
-- (companies that never touched Settings before won't have one yet).
INSERT INTO company_document_settings (company_id)
SELECT c.id FROM companies c
WHERE NOT EXISTS (
  SELECT 1 FROM company_document_settings s WHERE s.company_id = c.id
);

DO $$
DECLARE
  rec RECORD;
  decision text;
BEGIN
  FOR rec IN
    WITH people AS (
      SELECT company_id,
             (daily_rate IS NOT NULL AND daily_rate > 0)  AS is_daily,
             (hourly_rate IS NOT NULL AND hourly_rate > 0) AS is_hourly
      FROM profiles
      WHERE role = 'employee' AND status = 'active'
      UNION ALL
      SELECT company_id,
             (daily_rate IS NOT NULL AND daily_rate > 0)  AS is_daily,
             (hourly_rate IS NOT NULL AND hourly_rate > 0) AS is_hourly
      FROM workers
      WHERE status = 'active'
    )
    SELECT c.id AS company_id,
           c.name AS company_name,
           count(p.*) FILTER (WHERE p.is_daily)  AS daily_count,
           count(p.*) FILTER (WHERE p.is_hourly) AS hourly_count,
           count(p.*) AS total_count
    FROM companies c
    LEFT JOIN people p ON p.company_id = c.id
    GROUP BY c.id, c.name
  LOOP
    IF rec.total_count > 0 AND rec.daily_count = rec.total_count AND rec.hourly_count = 0 THEN
      decision := 'DAILY (auto-set)';
    ELSIF rec.total_count > 0 AND rec.hourly_count = rec.total_count AND rec.daily_count = 0 THEN
      decision := 'HOURLY (auto-set)';
    ELSIF rec.total_count = 0 THEN
      decision := 'left NULL — no active employees/workers with a rate yet';
    ELSE
      decision := 'left NULL — MIXED data (both daily-rate and hourly-rate people exist), admin must choose manually in Settings';
    END IF;

    RAISE NOTICE 'Company % (%): % active people with a rate (% daily / % hourly) -> %',
      rec.company_name, rec.company_id, rec.total_count, rec.daily_count, rec.hourly_count, decision;
  END LOOP;
END $$;

-- Auto-detect and apply: for each company, look at active profiles
-- (role='employee') and active workers. If every one of them has a positive
-- daily_rate and none has a positive hourly_rate, the company is clearly
-- Daily. If it's the reverse, the company is clearly Hourly. Anything else
-- (mixed, or no rate data at all) is left NULL.
WITH people AS (
  SELECT company_id,
         (daily_rate IS NOT NULL AND daily_rate > 0)  AS is_daily,
         (hourly_rate IS NOT NULL AND hourly_rate > 0) AS is_hourly
  FROM profiles
  WHERE role = 'employee' AND status = 'active'
  UNION ALL
  SELECT company_id,
         (daily_rate IS NOT NULL AND daily_rate > 0)  AS is_daily,
         (hourly_rate IS NOT NULL AND hourly_rate > 0) AS is_hourly
  FROM workers
  WHERE status = 'active'
),
company_modes AS (
  SELECT company_id,
         count(*) FILTER (WHERE is_daily)  AS daily_count,
         count(*) FILTER (WHERE is_hourly) AS hourly_count,
         count(*) AS total_count
  FROM people
  GROUP BY company_id
)
UPDATE company_document_settings s
SET pay_system = CASE
  WHEN cm.total_count > 0 AND cm.daily_count = cm.total_count AND cm.hourly_count = 0 THEN 'daily'
  WHEN cm.total_count > 0 AND cm.hourly_count = cm.total_count AND cm.daily_count = 0 THEN 'hourly'
  ELSE NULL
END
FROM company_modes cm
WHERE s.company_id = cm.company_id
  AND s.pay_system IS NULL;

COMMIT;
