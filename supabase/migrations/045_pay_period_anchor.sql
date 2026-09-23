-- Company pay-period start date (additive, nullable, safe to re-run).
--
-- With a date set, "Weekly" / "Bi-weekly" become real 7 / 14-day cycles
-- starting on that date (e.g. 2026-09-05 -> Sep 5–18, Sep 19–Oct 2, …),
-- used by Admin Payroll's Last/Current Pay Period and the employee
-- Home / Days / Pay screens. NULL keeps the previous behavior
-- (Sun–Sat weeks, 1–15 / 16–end halves), so no existing company changes.

ALTER TABLE company_document_settings
  ADD COLUMN IF NOT EXISTS pay_period_anchor date;
