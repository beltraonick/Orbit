'use server'

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

// Changing plans now goes through Stripe (app/actions/billing.ts). The old
// self-service switch is gone: it could mark a company "active" without
// any payment (e.g. by switching to the removed Free plan).
