-- Historical payroll immutability.
--
-- Payroll today is always computed live: PayrollManager, the Reports export,
-- and the XLSX export all join time_entries to each person's CURRENT
-- daily_rate/hourly_rate every time they're viewed. That means editing an
-- employee's rate, or changing the company's Pay System, silently changes
-- what a PAST, already-paid pay period shows. This migration adds a way to
-- freeze a period once it's been paid, so its numbers stop moving forever.
--
-- payroll_periods: one row per (company, date range) that an admin has
-- finalized ("Finalize Payroll" in the Payroll tab). Once created it is
-- never updated to reflect new rates — there is deliberately no "un-finalize"
-- action in the app, since the whole point is permanence.
--
-- payroll_period_entries: a frozen copy of what calcEntryPay() produced for
-- every time_entries row in that period AT THE MOMENT of finalizing —
-- person, rate, mode, amount all captured as values, not references. Later
-- rate changes, Pay System changes, or even edits to the original
-- time_entries row cannot affect these rows.

CREATE TABLE IF NOT EXISTS payroll_periods (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'finalized' check (status in ('finalized')),
  finalized_at  timestamptz not null default now(),
  finalized_by  uuid references profiles(id) on delete set null,
  grand_total   numeric(12,2) not null default 0,
  created_at    timestamptz not null default now(),
  unique (company_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS payroll_period_entries (
  id                    uuid primary key default gen_random_uuid(),
  payroll_period_id     uuid not null references payroll_periods(id) on delete cascade,
  company_id            uuid not null references companies(id) on delete cascade,
  source_time_entry_id  uuid references time_entries(id) on delete set null,
  person_type           text not null check (person_type in ('employee', 'worker')),
  person_id             uuid not null,
  person_name           text not null,
  entry_date            date not null,
  project_name          text,
  pay_mode              text not null check (pay_mode in ('daily', 'hourly')),
  daily_rate            numeric(10,2) not null default 0,
  hourly_rate           numeric(10,2) not null default 0,
  hours_worked          numeric(6,2),
  is_full_day           boolean,
  full_day              boolean not null default false,
  notes                 text,
  total_pay             numeric(10,2) not null default 0,
  overtime_hours        numeric(6,2) not null default 0,
  overtime_pay          numeric(10,2) not null default 0,
  created_at            timestamptz not null default now()
);

ALTER TABLE payroll_periods        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_period_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payroll_periods' AND policyname='anon_all') THEN
    CREATE POLICY "anon_all" ON payroll_periods FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payroll_period_entries' AND policyname='anon_all') THEN
    CREATE POLICY "anon_all" ON payroll_period_entries FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payroll_periods_company        ON payroll_periods(company_id);
CREATE INDEX IF NOT EXISTS idx_payroll_period_entries_period  ON payroll_period_entries(payroll_period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_period_entries_company ON payroll_period_entries(company_id);
