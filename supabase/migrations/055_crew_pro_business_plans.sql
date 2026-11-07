-- 055: Crew / Pro / Business plans, Stripe billing fields, and the
-- "trial ended" lock.
--
-- 1. plans: adds Crew ($59), Pro ($129) and Business ($249) with annual and
--    extra-person prices. The old Free/Starter/Growth rows stay (companies
--    may still point at them) but are marked inactive. The app reads prices
--    and limits from lib/plans.ts; these rows mirror it.
--
-- 2. companies: billing_interval, extra_seats and current_period_end, kept
--    in sync from Stripe by /api/billing/webhook.
--
-- 3. Existing companies move to the new plans:
--      - companies the owner marked active on Starter/Growth (paid by
--        hand, or partners) stay active, on Pro (every feature);
--      - everyone else on an old plan gets Pro on a fresh 30-day trial,
--        counted from when this runs, and then picks a plan like a new one.
--    Companies with the owner's "unlimited" override are not changed.
--
-- 4. orbit_company_blocked(): true when the trial ended without a
--    subscription, or the subscription was canceled. While blocked, the
--    app's signed-in users can still see and edit everything, but can't
--    CREATE new records in the main tables — so the team can't clock in.
--    Clocking OUT still works, and payroll can still be closed.
--    orbit_company_effective_plan(): the plan whose features apply now
--    (Pro during the trial). Crew can't create change orders or pay
--    approvals; that's enforced here too.
--    Server/service-role queries (sign-up, owner tools, Stripe webhook,
--    auto clock-out) are never blocked.
--
-- 5. Billing fields on companies (plan, status, trial, Stripe ids, extra
--    people, owner notes) can only be changed by the server (service role:
--    Stripe webhook, owner tools) — not from an admin's browser, where they
--    could otherwise mark their own company as paid. This replaces the
--    companies guard from migration 054, keeping its rules.
--
-- Safe to run multiple times: step 3 only touches companies still on an
-- old plan.

-- ── 1. plans ────────────────────────────────────────────────────────────────
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS annual_price_cents integer,
  ADD COLUMN IF NOT EXISTS extra_seat_cents integer,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

INSERT INTO plans (key, name, price_cents, annual_price_cents, extra_seat_cents, project_limit, admin_limit, employee_limit, is_popular, is_active)
VALUES
  ('crew',     'Crew',     5900,  59000,  400, NULL, 1,    10, false, true),
  ('pro',      'Pro',      12900, 129000, 400, NULL, 3,    30, true,  true),
  ('business', 'Business', 24900, 249000, 300, NULL, NULL, 75, false, true)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name, price_cents = EXCLUDED.price_cents,
  annual_price_cents = EXCLUDED.annual_price_cents, extra_seat_cents = EXCLUDED.extra_seat_cents,
  project_limit = EXCLUDED.project_limit, admin_limit = EXCLUDED.admin_limit,
  employee_limit = EXCLUDED.employee_limit, is_popular = EXCLUDED.is_popular, is_active = true;

UPDATE plans SET is_active = false, is_popular = false WHERE key IN ('free', 'starter', 'growth');

-- ── 2. companies ────────────────────────────────────────────────────────────
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS billing_interval text CHECK (billing_interval IN ('month', 'year')),
  ADD COLUMN IF NOT EXISTS extra_seats integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

-- ── 3. move existing companies ──────────────────────────────────────────────
-- Marked active by the owner on an old paid plan (paid by hand / partner): stays active, on Pro.
UPDATE companies c
SET plan_id = (SELECT id FROM plans WHERE key = 'pro')
FROM plans p
WHERE c.plan_id = p.id
  AND p.key IN ('starter', 'growth')
  AND c.subscription_status IN ('active', 'past_due')
  AND NOT c.unlimited_override;

-- Everyone else still on an old plan (or none): Pro, 30-day trial from now.
UPDATE companies c
SET plan_id = (SELECT id FROM plans WHERE key = 'pro'),
    subscription_status = 'trialing',
    trial_ends_at = now() + interval '30 days'
WHERE NOT c.unlimited_override
  AND c.stripe_subscription_id IS NULL
  AND (c.plan_id IS NULL OR c.plan_id IN (SELECT id FROM plans WHERE key IN ('free', 'starter', 'growth')));

-- ── 4. access functions + insert guard ──────────────────────────────────────
CREATE OR REPLACE FUNCTION orbit_company_blocked(cid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT coalesce((
    SELECT NOT c.unlimited_override AND (
      c.subscription_status = 'canceled'
      OR (c.subscription_status = 'trialing' AND c.trial_ends_at IS NOT NULL
          AND c.trial_ends_at < now() AND c.stripe_subscription_id IS NULL)
    )
    FROM companies c WHERE c.id = cid
  ), false)
$$;

CREATE OR REPLACE FUNCTION orbit_company_effective_plan(cid uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN c.unlimited_override THEN 'business'
    WHEN p.key = 'business' THEN 'business'
    WHEN c.subscription_status = 'trialing' THEN 'pro'
    WHEN p.key IN ('pro', 'growth', 'starter') THEN 'pro'
    ELSE 'crew'
  END
  FROM companies c LEFT JOIN plans p ON p.id = c.plan_id
  WHERE c.id = cid
$$;

GRANT EXECUTE ON FUNCTION orbit_company_blocked(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION orbit_company_effective_plan(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION orbit_guard_company_access()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cid uuid;
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  cid := NULLIF(to_jsonb(NEW)->>'company_id', '')::uuid;
  IF cid IS NULL THEN RETURN NEW; END IF;

  IF orbit_company_blocked(cid) THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE' USING ERRCODE = '42501',
      HINT = 'The trial ended or the subscription was canceled. An admin can choose a plan on the website.';
  END IF;

  IF TG_TABLE_NAME IN ('change_orders', 'pay_approvals') AND orbit_company_effective_plan(cid) = 'crew' THEN
    RAISE EXCEPTION 'PLAN_FEATURE_LOCKED' USING ERRCODE = '42501',
      HINT = 'Not included in the Crew plan.';
  END IF;

  RETURN NEW;
END $$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'time_entries', 'projects', 'tasks', 'task_media', 'project_photos',
    'expenses', 'receipts', 'mileage_trips', 'change_orders', 'workers',
    'vehicles', 'profiles', 'pay_approvals', 'day_off_requests'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'company_id') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS orbit_guard_company_access ON %I', tbl);
      EXECUTE format(
        'CREATE TRIGGER orbit_guard_company_access BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION orbit_guard_company_access()',
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- ── 5. companies guard (replaces 054's, adds the billing fields) ────────────
CREATE OR REPLACE FUNCTION orbit_guard_companies_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  protected text[] := ARRAY[
    'plan_id', 'subscription_status', 'trial_ends_at', 'stripe_customer_id',
    'stripe_subscription_id', 'billing_interval', 'extra_seats', 'current_period_end',
    'months_overdue', 'owner_notes', 'unlimited_override'
  ];
  k text;
BEGIN
  IF current_user <> 'authenticated' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF orbit_jwt_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF TG_OP = 'UPDATE' THEN
    FOREACH k IN ARRAY protected LOOP
      IF (to_jsonb(NEW)->k) IS DISTINCT FROM (to_jsonb(OLD)->k) THEN
        RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Only the dev "company row missing" path (app/actions/invites.ts) does
    -- this: it can never start out paid or unlimited.
    IF coalesce((to_jsonb(NEW)->>'unlimited_override')::boolean, false)
       OR (to_jsonb(NEW)->>'stripe_subscription_id') IS NOT NULL
       OR coalesce(to_jsonb(NEW)->>'subscription_status', 'trialing') <> 'trialing' THEN
      RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orbit_guard_companies_write ON companies;
CREATE TRIGGER orbit_guard_companies_write
  BEFORE INSERT OR UPDATE OR DELETE ON companies
  FOR EACH ROW EXECUTE FUNCTION orbit_guard_companies_write();

NOTIFY pgrst, 'reload schema';
