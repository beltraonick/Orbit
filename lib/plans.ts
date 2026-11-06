// OrbitOps subscription plans (Crew / Pro / Business). Prices in US cents.
// Shared by the server (limits, Stripe checkout) and the Settings screen.
// The `plans` table holds the same rows (migration 055) so companies can
// reference them, but this file is what the code reads.

export type PlanKey = 'crew' | 'pro' | 'business'
export type BillingInterval = 'month' | 'year'

export interface PlanDef {
  key: PlanKey
  name: string
  monthlyCents: number
  annualCents: number
  /** Price of each person over the included field team, per month. */
  extraSeatCents: number
  /** Field team included: active employees with a login + active workers. */
  fieldTeam: number
  /** null = unlimited. */
  admins: number | null
  popular: boolean
}

export const PLANS: Record<PlanKey, PlanDef> = {
  crew: { key: 'crew', name: 'Crew', monthlyCents: 5900, annualCents: 59000, extraSeatCents: 400, fieldTeam: 10, admins: 1, popular: false },
  pro: { key: 'pro', name: 'Pro', monthlyCents: 12900, annualCents: 129000, extraSeatCents: 400, fieldTeam: 30, admins: 3, popular: true },
  business: { key: 'business', name: 'Business', monthlyCents: 24900, annualCents: 249000, extraSeatCents: 300, fieldTeam: 75, admins: null, popular: false },
}

export const PLAN_ORDER: PlanKey[] = ['crew', 'pro', 'business']

export function isPlanKey(v: unknown): v is PlanKey {
  return v === 'crew' || v === 'pro' || v === 'business'
}

/** Plans from before Crew/Pro/Business map to the closest new one. */
export function normalizePlanKey(key: string | null | undefined): PlanKey | null {
  if (isPlanKey(key)) return key
  if (key === 'growth') return 'pro'
  if (key === 'starter' || key === 'free') return 'crew'
  return null
}

export type Feature = 'ai' | 'receiptAi' | 'quickbooks' | 'changeOrders' | 'supervisors' | 'payApproval'

const PLAN_FEATURES: Record<PlanKey, Record<Feature, boolean>> = {
  crew: { ai: false, receiptAi: false, quickbooks: false, changeOrders: false, supervisors: false, payApproval: false },
  pro: { ai: true, receiptAi: true, quickbooks: true, changeOrders: true, supervisors: true, payApproval: true },
  business: { ai: true, receiptAi: true, quickbooks: true, changeOrders: true, supervisors: true, payApproval: true },
}

export function planHasFeature(plan: PlanKey, feature: Feature): boolean {
  return PLAN_FEATURES[plan][feature]
}

export function formatUsd(cents: number): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 === 0 ? 0 : 2 })
}
