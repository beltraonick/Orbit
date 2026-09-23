-- Manual Compensation / Payroll Adjustments.
--
-- Extra work, bonuses, corrections, and production-paid subcontractor pay —
-- kept separate from and auditable against the base Daily/Hourly calculated
-- compensation. This is NOT a third company Pay System; it's an additive
-- line item that applies on top of (or instead of, for a subcontractor with
-- no other entries) a person's normal calculated pay for a period.
--
-- Deliberately does NOT require a time_entries row: no clock in/out, no
-- Full Day toggle, no fake attendance. A subcontractor who never logs in and
-- never clocks in can still be paid through this, reusing the existing
-- no-login `workers` table for who they are — see 028_workers_and_daily_rate.

CREATE TABLE IF NOT EXISTS manual_compensations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references companies(id) on delete cascade,
  person_type        text not null check (person_type in ('employee', 'worker')),
  person_id          uuid not null,
  person_name        text not null,
  amount             numeric(10,2) not null,
  compensation_date  date not null,
  category           text not null default 'extra_work'
                       check (category in ('extra_work', 'bonus', 'correction', 'production')),
  description        text not null,
  project_id         uuid references projects(id) on delete set null,
  created_by         uuid references profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  -- Set once this entry's date falls inside a finalized payroll period.
  -- From that point the app treats it as locked (no edit/delete), matching
  -- the immutability guarantee time-entry-based pay already has.
  payroll_period_id  uuid references payroll_periods(id) on delete set null
);

ALTER TABLE manual_compensations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='manual_compensations' AND policyname='anon_all') THEN
    CREATE POLICY "anon_all" ON manual_compensations FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_manual_comp_company ON manual_compensations(company_id);
CREATE INDEX IF NOT EXISTS idx_manual_comp_person   ON manual_compensations(person_id);
CREATE INDEX IF NOT EXISTS idx_manual_comp_date     ON manual_compensations(compensation_date);
CREATE INDEX IF NOT EXISTS idx_manual_comp_period   ON manual_compensations(payroll_period_id) WHERE payroll_period_id IS NOT NULL;

-- Extend the payroll snapshot (038) so "Finalize Payroll" can freeze manual
-- compensation lines alongside time-entry-based lines, in the same table.
ALTER TABLE payroll_period_entries
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'time_entry'
    CHECK (source_type IN ('time_entry', 'manual_compensation')),
  ADD COLUMN IF NOT EXISTS source_manual_compensation_id uuid references manual_compensations(id) on delete set null,
  ADD COLUMN IF NOT EXISTS category text
    CHECK (category IN ('extra_work', 'bonus', 'correction', 'production'));

ALTER TABLE payroll_period_entries DROP CONSTRAINT IF EXISTS payroll_period_entries_pay_mode_check;
ALTER TABLE payroll_period_entries
  ADD CONSTRAINT payroll_period_entries_pay_mode_check CHECK (pay_mode IN ('daily', 'hourly', 'manual'));
