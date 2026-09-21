-- Lets the platform owner grant a single company unlimited access with one
-- click, independent of whatever plan tier they're on. This is a Master
-- override, not a plan choice — checkRoleLimit/checkProjectLimit/checkChatLimit
-- (lib/plan-limits.ts) treat it the same way they already treat a plan with
-- no limit set: nothing is blocked.
-- Safe to run multiple times (IF NOT EXISTS guard).

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS unlimited_override boolean NOT NULL DEFAULT false;
