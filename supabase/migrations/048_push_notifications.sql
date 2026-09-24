-- Push notifications (additive, safe to re-run).
--
-- push_subscriptions: one row per device that tapped "Turn on notifications"
-- in Profile. Only the server (service role) reads or writes it — RLS is on
-- with no policies, so no browser key can list other people's devices.
--
-- profiles.notification_prefs: which categories a person wants
-- (tasks / payroll / projects / time). Missing keys count as ON.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  company_id  uuid references companies(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile ON push_subscriptions(profile_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL
    DEFAULT '{"tasks": true, "payroll": true, "projects": true, "time": true}'::jsonb;
