-- 030: Schema additions for expenses/mileage/vehicles/receipts modules
-- All additive (ALTER TABLE ... ADD COLUMN IF NOT EXISTS) — no existing data affected.

-- ─── expense_categories: add color column ─────────────────────────────────────
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS color text;

-- ─── vehicles: add color + assigned driver FK ─────────────────────────────────
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS assigned_to_profile_id uuid references profiles(id) on delete set null;
CREATE INDEX IF NOT EXISTS idx_vehicles_assigned ON vehicles(assigned_to_profile_id) WHERE assigned_to_profile_id IS NOT NULL;

-- ─── receipts: add file_url column ────────────────────────────────────────────
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS file_url text;

-- ─── expenses: rename submitted_by / reviewed_by to *_profile_id for clarity
--     and rename status to approval_status (consistent with time_entries) ──────
-- We add new columns, backfill, then mark old ones with a comment.
-- Since this is a new table (no existing data), we can do this cleanly.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS submitted_by_profile_id uuid references profiles(id) on delete cascade;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reviewed_by_profile_id  uuid references profiles(id) on delete set null;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approval_status text not null default 'draft'
  check (approval_status in ('draft', 'submitted', 'needs_review', 'approved', 'rejected'));

-- Backfill from old columns (safe because table is new — no rows yet in production)
UPDATE expenses SET submitted_by_profile_id = submitted_by WHERE submitted_by_profile_id IS NULL;
UPDATE expenses SET reviewed_by_profile_id  = reviewed_by  WHERE reviewed_by_profile_id  IS NULL;
UPDATE expenses SET approval_status         = status        WHERE approval_status = 'draft';

-- ─── mileage_trips: same pattern ──────────────────────────────────────────────
ALTER TABLE mileage_trips ADD COLUMN IF NOT EXISTS employee_profile_id uuid references profiles(id) on delete cascade;
ALTER TABLE mileage_trips ADD COLUMN IF NOT EXISTS reviewed_by_profile_id uuid references profiles(id) on delete set null;
ALTER TABLE mileage_trips ADD COLUMN IF NOT EXISTS approval_status text not null default 'draft'
  check (approval_status in ('draft', 'submitted', 'needs_review', 'approved', 'rejected'));
ALTER TABLE mileage_trips ADD COLUMN IF NOT EXISTS gps_start_lat numeric(10,7);
ALTER TABLE mileage_trips ADD COLUMN IF NOT EXISTS gps_start_lng numeric(10,7);
ALTER TABLE mileage_trips ADD COLUMN IF NOT EXISTS gps_end_lat   numeric(10,7);
ALTER TABLE mileage_trips ADD COLUMN IF NOT EXISTS gps_end_lng   numeric(10,7);

UPDATE mileage_trips SET employee_profile_id   = employee_id  WHERE employee_profile_id   IS NULL;
UPDATE mileage_trips SET reviewed_by_profile_id = reviewed_by  WHERE reviewed_by_profile_id IS NULL;
UPDATE mileage_trips SET approval_status         = status        WHERE approval_status = 'draft';

-- ─── company_document_settings: add mileage_rate_per_mile alias ───────────────
ALTER TABLE company_document_settings ADD COLUMN IF NOT EXISTS mileage_rate_per_mile numeric(6,4) not null default 0.6700;
UPDATE company_document_settings SET mileage_rate_per_mile = mileage_rate WHERE mileage_rate_per_mile = 0.6700 AND mileage_rate != 0.6700;

-- ─── Indexes for new columns ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_expenses_submitted_by_profile  ON expenses(submitted_by_profile_id);
CREATE INDEX IF NOT EXISTS idx_expenses_approval_status       ON expenses(approval_status);
CREATE INDEX IF NOT EXISTS idx_mileage_employee_profile       ON mileage_trips(employee_profile_id);
CREATE INDEX IF NOT EXISTS idx_mileage_approval_status        ON mileage_trips(approval_status);
