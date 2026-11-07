import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PLANS, normalizePlanKey, planHasFeature, type BillingInterval, type Feature, type PlanKey } from '@/lib/plans'

// What a company can do right now, from its plan and subscription status.
//
//   trialing  — the 30-day trial (lib/trial.ts): everything in Pro.
//   active    — paid (confirmed by Stripe, or marked by the owner): its plan.
//   past_due  — a payment failed and Stripe is retrying: its plan, with a warning.
//   canceled  — subscription ended: read-only, team can't clock in.
//
// A trial that ran out without a subscription is "expired": same as canceled.
// Nothing needs to flip the status for that — it's worked out from the date,
// here and in the database guard (migration 055, orbit_company_blocked()).
// The owner's "unlimited" override always means full access.

export type AccessState = 'trial' | 'active' | 'past_due' | 'expired' | 'canceled'

export interface CompanyAccess {
  state: AccessState
  /** The plan the company picked (or was moved to). */
  planKey: PlanKey
  /** The plan whose features/limits apply now (Pro during the trial). */
  effectivePlanKey: PlanKey
  /** Read-only + no clock-in. */
  blocked: boolean
  trialEndsAt: string | null
  trialDaysLeft: number | null
  subscribed: boolean
  interval: BillingInterval | null
  extraSeats: number
  unlimited: boolean
}

interface CompanyBillingRow {
  subscription_status: string | null
  trial_ends_at: string | null
  stripe_subscription_id: string | null
  billing_interval: string | null
  extra_seats: number | null
  unlimited_override: boolean | null
  plan: { key: string } | { key: string }[] | null
}

export function accessFromRow(row: CompanyBillingRow | null, now = Date.now()): CompanyAccess {
  const planRel = Array.isArray(row?.plan) ? row?.plan[0] : row?.plan
  const planKey = normalizePlanKey(planRel?.key) ?? 'pro'
  const unlimited = !!row?.unlimited_override
  const subscribed = !!row?.stripe_subscription_id
  const trialEndsAt = row?.trial_ends_at ?? null
  const trialEndMs = trialEndsAt ? new Date(trialEndsAt).getTime() : null
  const status = row?.subscription_status ?? 'trialing'

  let state: AccessState
  if (status === 'active') state = 'active'
  else if (status === 'past_due') state = 'past_due'
  else if (status === 'canceled') state = 'canceled'
  else if (trialEndMs != null && trialEndMs < now && !subscribed) state = 'expired'
  else state = 'trial'

  const blocked = !unlimited && (state === 'expired' || state === 'canceled')
  // During the trial everything in Pro is on — Business keeps Business.
  const effectivePlanKey: PlanKey = unlimited ? 'business' : state === 'trial' && planKey === 'crew' ? 'pro' : planKey

  return {
    state,
    planKey,
    effectivePlanKey,
    blocked,
    trialEndsAt,
    trialDaysLeft: state === 'trial' && trialEndMs != null ? Math.max(0, Math.ceil((trialEndMs - now) / 86_400_000)) : null,
    subscribed,
    interval: row?.billing_interval === 'year' ? 'year' : row?.billing_interval === 'month' ? 'month' : null,
    extraSeats: Math.max(0, row?.extra_seats ?? 0),
    unlimited,
  }
}

export const COMPANY_BILLING_COLUMNS =
  'subscription_status, trial_ends_at, stripe_subscription_id, billing_interval, extra_seats, unlimited_override, plan:plan_id(key)'

// Columns that exist before migration 055 — used if the new ones aren't there
// yet, so a deploy ahead of the migration still reads the real status and the
// owner's "unlimited" override.
const LEGACY_BILLING_COLUMNS =
  'subscription_status, trial_ends_at, stripe_subscription_id, unlimited_override, plan:plan_id(key)'

export async function getCompanyAccess(supabase: SupabaseClient, companyId: string): Promise<CompanyAccess> {
  const { data, error } = await supabase
    .from('companies')
    .select(COMPANY_BILLING_COLUMNS)
    .eq('id', companyId)
    .maybeSingle()
  if (!error) return accessFromRow(data as CompanyBillingRow | null)

  const legacy = await supabase
    .from('companies')
    .select(LEGACY_BILLING_COLUMNS)
    .eq('id', companyId)
    .maybeSingle()
  const row = legacy.data as Omit<CompanyBillingRow, 'billing_interval' | 'extra_seats'> | null
  return accessFromRow(row ? { ...row, billing_interval: null, extra_seats: 0 } : null)
}

export function accessHasFeature(access: CompanyAccess, feature: Feature): boolean {
  if (access.unlimited) return true
  if (access.blocked) return false
  return planHasFeature(access.effectivePlanKey, feature)
}

/** Field-team and admin limits for the plan in effect, plus any extra seats bought. */
export function accessLimits(access: CompanyAccess): { fieldTeam: number | null; admins: number | null } {
  if (access.unlimited) return { fieldTeam: null, admins: null }
  const plan = PLANS[access.effectivePlanKey]
  return { fieldTeam: plan.fieldTeam + access.extraSeats, admins: plan.admins }
}

export const FEATURE_LOCKED_MESSAGE = 'This feature is not included in your plan. Upgrade in Settings > Plan & Billing.'
export const ACCOUNT_INACTIVE_MESSAGE = 'Your account needs attention. Please contact your company administrator.'

/**
 * For API routes: a 403 Response when the company's plan doesn't include
 * `feature` (or the account is blocked), otherwise null.
 */
export async function featureLockedResponse(
  supabase: SupabaseClient,
  companyId: string | null | undefined,
  feature: Feature,
): Promise<Response | null> {
  if (!companyId) return null
  const access = await getCompanyAccess(supabase, companyId)
  if (accessHasFeature(access, feature)) return null
  return Response.json(
    { error: access.blocked ? ACCOUNT_INACTIVE_MESSAGE : FEATURE_LOCKED_MESSAGE, code: access.blocked ? 'ACCOUNT_INACTIVE' : 'PLAN_FEATURE_LOCKED' },
    { status: 403 },
  )
}
