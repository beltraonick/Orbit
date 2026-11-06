'use server'

import { trialEndDate } from '@/lib/trial'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/session'

export interface CompanyPlanInfo {
  plan_key: string | null
  plan_name: string | null
  price_cents: number | null
  subscription_status: string
  trial_ends_at: string | null
}

export async function getCompanyPlan(): Promise<{ error?: string; info?: CompanyPlanInfo }> {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Not authorized.' }

  const supabase = createClient()
  const { data: company } = await supabase
    .from('companies')
    .select('subscription_status, trial_ends_at, plan:plan_id(key, name, price_cents)')
    .eq('id', user.company_id)
    .maybeSingle()

  if (!company) return { error: 'Company not found.' }

  const plan = company.plan as unknown as { key: string; name: string; price_cents: number } | null
  return {
    info: {
      plan_key: plan?.key ?? null,
      plan_name: plan?.name ?? null,
      price_cents: plan?.price_cents ?? null,
      subscription_status: company.subscription_status,
      trial_ends_at: company.trial_ends_at,
    },
  }
}

// Self-service plan switch — no payment gateway behind this yet, so it
// only ever assigns the plan itself. Free needs no payment and goes
// active immediately; a paid plan starts (or keeps) a trial — it never
// auto-marks the account as a confirmed payer. Only the owner flips
// that to "active" once a real payment has actually been confirmed.
export async function changeCompanyPlan(planKey: 'free' | 'starter' | 'growth'): Promise<{ error?: string }> {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Not authorized.' }

  const supabase = createClient()
  const { data: plan } = await supabase.from('plans').select('id, key').eq('key', planKey).maybeSingle()
  if (!plan) return { error: 'Plan not found.' }

  const { data: company } = await supabase
    .from('companies')
    .select('subscription_status, created_at, plan:plan_id(key)')
    .eq('id', user.company_id)
    .maybeSingle()

  // "active" on the Free plan only means "free", not that anyone has paid —
  // so leaving Free for a paid plan still goes through the trial.
  const currentPlanKey = (company?.plan as { key?: string } | null)?.key
  const isConfirmedPayer =
    (company?.subscription_status === 'active' || company?.subscription_status === 'past_due') &&
    currentPlanKey !== 'free'

  const updates: { plan_id: string; subscription_status?: string; trial_ends_at?: string | null } = {
    plan_id: plan.id,
  }

  if (planKey === 'free') {
    updates.subscription_status = 'active'
    updates.trial_ends_at = null
  } else if (!isConfirmedPayer) {
    // Not already a confirmed payer — a paid plan is a trial rather than
    // faking "active". The 30 days count from sign-up (lib/trial.ts), so
    // switching plans never restarts it.
    updates.subscription_status = 'trialing'
    updates.trial_ends_at = trialEndDate(company?.created_at)
  }

  const { error } = await supabase.from('companies').update(updates).eq('id', user.company_id)
  if (error) return { error: error.message }
  return {}
}
