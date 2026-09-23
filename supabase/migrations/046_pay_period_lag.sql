-- Pay period lag (additive, nullable-safe default, safe to re-run).
--
-- Some companies process payroll on a delay: today's "current" cycle by the
-- calendar isn't what's actually being paid right now — the payment in
-- flight is for a period that already ended. Without this, "Current Period"
-- on the employee's Home/Days/Pay screens (and Admin Payroll/Time's
-- "Current Pay Period") would show the in-progress cycle, which doesn't
-- match the pay employees are actually about to receive and confuses them.
--
-- pay_period_lag counts whole periods to step back before calling a cycle
-- "current" (0 = no delay, the existing/default behavior; 1 = the payment
-- happening now is for the period before this one). Set once in
-- Settings -> Pay Period; never needs manual date-juggling per cycle.

ALTER TABLE company_document_settings
  ADD COLUMN IF NOT EXISTS pay_period_lag integer NOT NULL DEFAULT 0
    CHECK (pay_period_lag >= 0 AND pay_period_lag <= 6);
