-- Add 'deduction' to the category enum for manual_compensations.
-- Deductions are stored as negative amounts (e.g. -150.00).
-- The frontend auto-negates the value when category = 'deduction',
-- so the admin always enters a positive dollar amount and never types a minus sign.

ALTER TABLE manual_compensations
  DROP CONSTRAINT IF EXISTS manual_compensations_category_check;

ALTER TABLE manual_compensations
  ADD CONSTRAINT manual_compensations_category_check
  CHECK (category IN ('extra_work', 'bonus', 'correction', 'production', 'deduction'));

-- Mirror the same change on the payroll snapshot table so finalized
-- periods can freeze deduction lines alongside the other categories.
ALTER TABLE payroll_period_entries
  DROP CONSTRAINT IF EXISTS payroll_period_entries_category_check;

ALTER TABLE payroll_period_entries
  ADD CONSTRAINT payroll_period_entries_category_check
  CHECK (category IN ('extra_work', 'bonus', 'correction', 'production', 'deduction'));
