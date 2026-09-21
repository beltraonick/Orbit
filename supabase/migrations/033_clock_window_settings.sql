-- Optional per-company clock-in/out window (opt-in — off by default so no
-- existing company is suddenly restricted). When enabled, an employee's
-- OWN clock-in button (Home tab) only works inside clock_in_window_start
-- to clock_in_window_end, and anyone still clocked in past
-- clock_out_deadline gets auto clocked-out by the /api/cron/auto-clockout
-- route (see vercel.json). Supervisors/admins are exempt when clocking a
-- team member in via the Team Clock tool — this only gates self clock-in.
-- Times are stored as plain 'HH:MM' text in the company's own local time
-- (timezone column), not UTC.
-- Safe to run multiple times.

ALTER TABLE company_document_settings
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York',
  ADD COLUMN IF NOT EXISTS enforce_clock_window boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clock_in_window_start text NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS clock_in_window_end text NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS clock_out_deadline text NOT NULL DEFAULT '18:00';
