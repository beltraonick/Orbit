-- Configurable period for the employee/supervisor home dashboard stats tiles.
-- Each company can choose: weekly (Sun–Sat), biweekly (1–15 / 16–EOM),
-- or monthly. Defaults to biweekly. Changed by the admin in Settings.

ALTER TABLE company_document_settings
  ADD COLUMN IF NOT EXISTS home_period_type text NOT NULL DEFAULT 'biweekly'
    CHECK (home_period_type IN ('weekly', 'biweekly', 'monthly'));
