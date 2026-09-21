-- 034: self_clockin permission + expenses paid status
-- Safe to run multiple times.

-- Grant self_clockin=true to all existing employees who don't have it yet.
-- New employees get it from the admin UI (defaults checked unless admin unchecks).
UPDATE profiles
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'),
  '{self_clockin}',
  'true'
)
WHERE role = 'employee'
  AND (permissions IS NULL OR NOT (permissions ? 'self_clockin'));

-- Add paid_at and paid_by columns to expenses
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS paid_at  timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by  uuid REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_paid_by ON expenses(paid_by) WHERE paid_by IS NOT NULL;

-- Extend the approval_status check constraint to include 'paid'
-- Drop the existing constraint (added in migration 030) and recreate it.
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_approval_status_check;
ALTER TABLE expenses ADD CONSTRAINT expenses_approval_status_check
  CHECK (approval_status IN ('draft', 'submitted', 'needs_review', 'approved', 'rejected', 'paid'));
