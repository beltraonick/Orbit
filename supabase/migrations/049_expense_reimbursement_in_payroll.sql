-- 049: Include approved expense reimbursements in payroll totals
-- Approved reimbursement-type expenses (not company card) owed to an employee
-- now appear in the Payroll page total, the employee Pay page, and are frozen
-- into payroll_period_entries when a period is finalized — exactly like
-- manual_compensations. They are excluded from payroll only once paid
-- (approval_status = 'paid') to avoid double-counting.

-- ─── 1. Track which payroll period an expense was locked into ─────────────────
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS payroll_period_id uuid
    REFERENCES payroll_periods(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_payroll_period
  ON expenses(payroll_period_id) WHERE payroll_period_id IS NOT NULL;

-- ─── 2. Extend payroll_period_entries to store expense reimbursement snapshots ─

-- Add a FK column for the source expense row.
ALTER TABLE payroll_period_entries
  ADD COLUMN IF NOT EXISTS source_expense_id uuid
    REFERENCES expenses(id) ON DELETE SET NULL;

-- Widen the source_type check to accept the new value.
ALTER TABLE payroll_period_entries
  DROP CONSTRAINT IF EXISTS payroll_period_entries_source_type_check;

ALTER TABLE payroll_period_entries
  ADD CONSTRAINT payroll_period_entries_source_type_check
    CHECK (source_type IN ('time_entry', 'manual_compensation', 'expense_reimbursement'));

CREATE INDEX IF NOT EXISTS idx_payroll_entries_expense
  ON payroll_period_entries(source_expense_id) WHERE source_expense_id IS NOT NULL;
