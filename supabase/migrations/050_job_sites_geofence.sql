-- Job sites for geofencing: each company can define named locations with a
-- GPS coordinate and radius. When geofencing is enabled, employees can only
-- clock themselves in while within the radius of at least one active site.

CREATE TABLE IF NOT EXISTS job_sites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  radius_meters INT NOT NULL DEFAULT 200,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS job_sites_company_id_idx ON job_sites (company_id);

-- Per-company flag: when FALSE the geofence is ignored and anyone can clock in
-- from anywhere (same pattern as enforce_clock_window).
ALTER TABLE company_document_settings
  ADD COLUMN IF NOT EXISTS geofence_enabled BOOLEAN NOT NULL DEFAULT FALSE;
