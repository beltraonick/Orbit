-- 054: Login throttling + role guard on profiles/companies.
--
-- 1. login_attempts — failed logins, so lib/auth/rate-limit.ts can refuse
--    login for a while after too many wrong passwords. RLS on with NO
--    policies: only the service role (the server) can read or write it.
--
-- 2. Role guard on profiles. Migration 040's policy only checks the
--    company, so any signed-in employee's browser token could update ANY
--    profile of their company — e.g. make themselves admin, or set an
--    admin's password. From now on, for requests running as
--    `authenticated` (the app's signed-in users):
--      - only an admin can insert, delete, or edit other people's profiles;
--      - an employee/client can edit only their OWN row, and only the
--        fields the Profile screen edits (name, phone, photo, language,
--        notifications, password) plus last_login_at;
--      - nobody can create or grant the platform-owner role.
--    The server's service-role queries (login, sign-up, owner tools) are
--    not affected.
--
-- 3. Role guard on companies: only an admin can change their company row,
--    and nobody but the owner tools can change unlimited_override.
--
-- Safe to run multiple times.

-- ── 1. login_attempts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS login_attempts (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL,
  ip            text,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, attempted_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, attempted_at);
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON login_attempts FROM anon, authenticated;

-- ── 2. profiles guard ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION orbit_guard_profiles_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  self_editable text[] := ARRAY[
    'full_name', 'phone', 'avatar_url', 'language', 'email_notifications',
    'password_hash', 'last_login_at', 'updated_at'
  ];
  jwt_sub text := current_setting('request.jwt.claims', true)::json->>'sub';
BEGIN
  -- Only the app's signed-in users are restricted; the service role is not.
  IF current_user <> 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'owner' OR orbit_jwt_role() IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF orbit_jwt_role() IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE
  IF NEW.role = 'owner' AND OLD.role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF orbit_jwt_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  IF OLD.id::text = jwt_sub
     AND (to_jsonb(NEW) - self_editable) = (to_jsonb(OLD) - self_editable) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS orbit_guard_profiles_write ON profiles;
CREATE TRIGGER orbit_guard_profiles_write
  BEFORE INSERT OR UPDATE OR DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION orbit_guard_profiles_write();

-- ── 3. companies guard ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION orbit_guard_companies_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user <> 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF orbit_jwt_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  -- Read through jsonb so this works whether or not the column exists.
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW)->'unlimited_override') IS DISTINCT FROM (to_jsonb(OLD)->'unlimited_override') THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND COALESCE((to_jsonb(NEW)->>'unlimited_override')::boolean, false) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orbit_guard_companies_write ON companies;
CREATE TRIGGER orbit_guard_companies_write
  BEFORE INSERT OR UPDATE OR DELETE ON companies
  FOR EACH ROW EXECUTE FUNCTION orbit_guard_companies_write();

NOTIFY pgrst, 'reload schema';
