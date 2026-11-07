import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { isPlanKey, type PlanKey } from '@/lib/plans'
import { SEAT_PRODUCT_ID, planProductId, type StripeSubscription } from '@/lib/stripe'

// Copies a Stripe subscription onto its company row (status, plan, interval,
// extra people, trial/period dates). Called by the webhook and right after
// the admin changes the subscription, so the app doesn't wait for the webhook.
// Uses the service role: the webhook has no signed-in user.

function mapStatus(s: StripeSubscription['status']): 'trialing' | 'active' | 'past_due' | 'canceled' | null {
  switch (s) {
    case 'trialing': return 'trialing'
    case 'active': return 'active'
    case 'past_due': return 'past_due'
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
    case 'paused':
      return 'canceled'
    default:
      return null // 'incomplete': first payment still pending — leave as is
  }
}

function planFromSubscription(sub: StripeSubscription): PlanKey | null {
  const fromMeta = sub.metadata?.plan_key
  if (isPlanKey(fromMeta)) return fromMeta
  for (const item of sub.items?.data ?? []) {
    const product = item.price?.product
    for (const key of ['crew', 'pro', 'business'] as PlanKey[]) {
      if (product === planProductId(key)) return key
    }
  }
  return null
}

export async function syncCompanyFromSubscription(sub: StripeSubscription): Promise<{ companyId: string | null }> {
  const supabase = createServiceRoleClient()

  let companyId: string | null = sub.metadata?.company_id || null
  if (!companyId) {
    const { data } = await supabase.from('companies').select('id').eq('stripe_customer_id', sub.customer).maybeSingle()
    companyId = data?.id ?? null
  }
  if (!companyId) return { companyId: null }

  const updates: Record<string, unknown> = {
    stripe_customer_id: sub.customer,
    stripe_subscription_id: sub.id,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
  }

  const status = mapStatus(sub.status)
  if (status) updates.subscription_status = status
  if (status === 'trialing' && sub.trial_end) updates.trial_ends_at = new Date(sub.trial_end * 1000).toISOString()
  if (status === 'active' || status === 'past_due') updates.months_overdue = 0

  const planKey = planFromSubscription(sub)
  if (planKey) {
    const { data: plan } = await supabase.from('plans').select('id').eq('key', planKey).maybeSingle()
    if (plan) updates.plan_id = plan.id
  }

  const planItem = sub.items?.data?.find(i => i.price?.product !== SEAT_PRODUCT_ID)
  const seatItem = sub.items?.data?.find(i => i.price?.product === SEAT_PRODUCT_ID)
  const interval = planItem?.price?.recurring?.interval
  if (interval === 'month' || interval === 'year') updates.billing_interval = interval
  updates.extra_seats = seatItem?.quantity ?? 0

  await supabase.from('companies').update(updates).eq('id', companyId)
  return { companyId }
}
