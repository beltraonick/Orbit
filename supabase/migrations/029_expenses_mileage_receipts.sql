-- 029: Expenses, receipts, mileage, vehicles, company document settings

-- ─── 1. Company document settings (1:1 with companies) ────────────────────────
CREATE TABLE IF NOT EXISTS company_document_settings (
  id              uuid        primary key default gen_random_uuid(),
  company_id      uuid        not null unique references companies(id) on delete cascade,
  logo_storage_path text,
  primary_color   text        not null default '#007AFF',
  document_header text,
  document_footer text,
  currency_code   text        not null default 'USD',
  mileage_rate    numeric(6,4) not null default 0.6700,
  updated_at      timestamptz not null default now()
);

-- ─── 2. Expense categories ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expense_categories (
  id             uuid        primary key default gen_random_uuid(),
  company_id     uuid        not null references companies(id) on delete cascade,
  name           text        not null,
  is_reimbursable boolean    not null default true,
  created_at     timestamptz not null default now()
);

-- ─── 3. Receipts ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS receipts (
  id                uuid        primary key default gen_random_uuid(),
  company_id        uuid        not null references companies(id) on delete cascade,
  uploaded_by       uuid        not null references profiles(id) on delete cascade,
  file_path         text        not null,
  file_hash         text,
  merchant_name     text,
  transaction_date  date,
  total_amount      numeric(10,2),
  currency_code     text        not null default 'USD',
  last_four_digits  text,
  line_items        jsonb       not null default '[]',
  ai_confidence     real,
  status            text        not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected')),
  duplicate_of      uuid        references receipts(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ─── 4. Expenses / Reimbursements ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id             uuid        primary key default gen_random_uuid(),
  company_id     uuid        not null references companies(id) on delete cascade,
  submitted_by   uuid        not null references profiles(id) on delete cascade,
  receipt_id     uuid        references receipts(id) on delete set null,
  category_id    uuid        references expense_categories(id) on delete set null,
  expense_type   text        not null default 'company'
    check (expense_type in ('company', 'reimbursement')),
  description    text        not null,
  amount         numeric(10,2) not null,
  expense_date   date        not null,
  project_id     uuid        references projects(id) on delete set null,
  status         text        not null default 'draft'
    check (status in ('draft', 'submitted', 'needs_review', 'approved', 'rejected')),
  reviewed_by    uuid        references profiles(id) on delete set null,
  reviewed_at    timestamptz,
  reviewer_notes text,
  paid_at        timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ─── 5. Vehicles ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id             uuid        primary key default gen_random_uuid(),
  company_id     uuid        not null references companies(id) on delete cascade,
  name           text        not null,
  vehicle_type   text        not null default 'company'
    check (vehicle_type in ('company', 'rental', 'personal')),
  make           text,
  model          text,
  year           int,
  license_plate  text,
  status         text        not null default 'active'
    check (status in ('active', 'inactive')),
  created_at     timestamptz not null default now()
);

-- ─── 6. Mileage trips ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mileage_trips (
  id                    uuid        primary key default gen_random_uuid(),
  company_id            uuid        not null references companies(id) on delete cascade,
  employee_id           uuid        not null references profiles(id) on delete cascade,
  vehicle_id            uuid        references vehicles(id) on delete set null,
  project_id            uuid        references projects(id) on delete set null,
  trip_type             text        not null default 'manual'
    check (trip_type in ('manual', 'gps')),
  trip_date             date        not null,
  origin                text,
  destination           text,
  purpose               text,
  distance_miles        numeric(8,2) not null,
  gps_track             jsonb,
  rate_at_submission    numeric(6,4),
  reimbursement_amount  numeric(10,2),
  status                text        not null default 'draft'
    check (status in ('draft', 'submitted', 'needs_review', 'approved', 'rejected')),
  reviewed_by           uuid        references profiles(id) on delete set null,
  reviewed_at           timestamptz,
  reviewer_notes        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- ─── 7. RLS (anon_all — app handles authorization via company_id checks) ──────
ALTER TABLE company_document_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mileage_trips             ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'company_document_settings',
    'expense_categories',
    'receipts',
    'expenses',
    'vehicles',
    'mileage_trips'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = tbl AND policyname = 'anon_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "anon_all" ON %I FOR ALL TO anon USING (true) WITH CHECK (true)',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- ─── 8. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_company_doc_settings_company  ON company_document_settings(company_id);
CREATE INDEX IF NOT EXISTS idx_expense_categories_company    ON expense_categories(company_id);
CREATE INDEX IF NOT EXISTS idx_receipts_company              ON receipts(company_id);
CREATE INDEX IF NOT EXISTS idx_receipts_uploaded_by          ON receipts(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_receipts_hash                 ON receipts(file_hash) WHERE file_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_company              ON expenses(company_id);
CREATE INDEX IF NOT EXISTS idx_expenses_submitted_by         ON expenses(submitted_by);
CREATE INDEX IF NOT EXISTS idx_expenses_status               ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_company              ON vehicles(company_id);
CREATE INDEX IF NOT EXISTS idx_mileage_trips_company         ON mileage_trips(company_id);
CREATE INDEX IF NOT EXISTS idx_mileage_trips_employee        ON mileage_trips(employee_id);
CREATE INDEX IF NOT EXISTS idx_mileage_trips_status          ON mileage_trips(status);
