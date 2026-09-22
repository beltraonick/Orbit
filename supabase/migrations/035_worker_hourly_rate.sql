-- Add hourly_rate to workers so admins can choose hourly or daily pay mode
-- for no-login workers, just like they can for employees with logins.

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(10,2);
