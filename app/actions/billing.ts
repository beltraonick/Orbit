'use server'

import { headers } from 'next/headers'
import { getCurrentUser, getImpersonatorToken } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { accessLimits, getCompanyAccess, type CompanyAccess } from '@/lib/billing'
import { countAdmins, countFieldTeam } from '@/lib/plan-limits'
import { PLANS, PLAN_ORDER, isPlanKey, type BillingInterval, type PlanKey } from '@/lib/plans'
import { syncCompanyFromSubscription } from '@/lib/billing-sync'
import {
  SEAT_PRODUCT_ID, StripeError, ensureProducts, planPriceData, seatPriceData, stripe, stripeConfigured,
  type StripeSubscription,
} from '@/lib/stripe'

// Plan & Billing in Settings (website only — the iOS app never shows prices
// or purchase buttons). All payment pages are Stripe's own: Checkout to
// subscribe, the Customer Portal for card, invoices and cancelling.

export interface BillingOverview {
  access: CompanyAccess
  fieldTeamUsed: number
  adminsUsed: number
  fieldTeamLimit: number | null
  adminLimit: number | null
  stripeReady: boolean
}

function requireAdmin() {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) return null
  // The platform owner looking at an account must never change its billing.
  if (getImpersonatorToken()) return null
  return user
}

function appOrigin(): string {
  const h = headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'orbitconstructions.vercel.app'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return `${proto}://${host}`
}

function friendlyStripeError(err: unknown): string {
  if (err instanceof StripeError) return `Payment provider error: ${err.message}`
  return 'Could not reach the payment provider. Please try again.'
}

export async function getBillingOverview(): Promise<{ error?: string; overview?: BillingOverview }> {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) return { error: 'Not authorized.' }
  const supabase = createClient()
  const [access, fieldTeamUsed, adminsUsed] = await Promise.all([
    getCompanyAccess(supabase, user.company_id),
    countFieldTeam(supabase, user.company_id),
    countAdmins(supabase, user.company_id),
  ])
  const limits = accessLimits(access)
  return {
    overview: {
      access,
      fieldTeamUsed,
      adminsUsed,
      fieldTeamLimit: limits.fieldTeam,
      adminLimit: limits.admins,
      stripeReady: stripeConfigured(),
    },
  }
}

/** Extra people needed so the current team fits `plan` (never fewer than already bought). */
function seatsNeeded(plan: PlanKey, fieldTeamUsed: number, currentExtra: number): number {
  return Math.max(currentExtra, fieldTeamUsed - PLANS[plan].fieldTeam, 0)
}

async function checkFitsPlan(companyId: string, plan: PlanKey): Promise<string | null> {
  const supabase = createClient()
  const admins = await countAdmins(supabase, companyId)
  const limit = PLANS[plan].admins
  if (limit != null && admins > limit) {
    return `The ${PLANS[plan].name} plan allows ${limit} admin${limit === 1 ? '' : 's'} and you have ${admins}. Change the extra admins to employees first, or pick a bigger plan.`
  }
  return null
}

async function ensureCustomer(companyId: string, email: string): Promise<string> {
  const admin = createServiceRoleClient()
  const { data: company } = await admin.from('companies').select('name, stripe_customer_id').eq('id', companyId).maybeSingle()
  if (company?.stripe_customer_id) return company.stripe_customer_id
  const customer = await stripe<{ id: string }>('POST', '/customers', {
    email,
    name: company?.name ?? undefined,
    metadata: { company_id: companyId },
  })
  await admin.from('companies').update({ stripe_customer_id: customer.id }).eq('id', companyId)
  return customer.id
}

/** New subscription → Stripe Checkout. Returns the page to send the admin to. */
export async function startCheckout(planKey: string, interval: string): Promise<{ error?: string; url?: string }> {
  const user = requireAdmin()
  if (!user) return { error: 'Not authorized.' }
  if (!isPlanKey(planKey) || (interval !== 'month' && interval !== 'year')) return { error: 'Invalid plan.' }
  if (!stripeConfigured()) return { error: 'Online payment is not set up yet. Please contact OrbitOps support.' }
  const companyId = user.company_id as string

  const supabase = createClient()
  const access = await getCompanyAccess(supabase, companyId)
  if (access.subscribed && access.state !== 'canceled') {
    return { error: 'This company already has a subscription. Use "Change plan" instead.' }
  }
  const fitError = await checkFitsPlan(companyId, planKey)
  if (fitError) return { error: fitError }

  try {
    await ensureProducts()
    const customer = await ensureCustomer(companyId, user.email)
    const seats = seatsNeeded(planKey, await countFieldTeam(supabase, companyId), access.extraSeats)

    // Subscribing during the trial keeps the remaining days: first charge
    // when the trial ends. (Stripe needs a trial end at least 48h away.)
    const trialEnd =
      access.state === 'trial' && access.trialEndsAt && new Date(access.trialEndsAt).getTime() > Date.now() + 48 * 3600 * 1000
        ? Math.floor(new Date(access.trialEndsAt).getTime() / 1000)
        : undefined

    const lineItems: Array<Record<string, unknown>> = [{ price_data: planPriceData(planKey, interval), quantity: 1 }]
    if (seats > 0) lineItems.push({ price_data: seatPriceData(planKey, interval), quantity: seats })

    const origin = appOrigin()
    const session = await stripe<{ url: string }>('POST', '/checkout/sessions', {
      mode: 'subscription',
      customer,
      client_reference_id: companyId,
      line_items: lineItems,
      subscription_data: {
        metadata: { company_id: companyId, plan_key: planKey },
        trial_end: trialEnd,
      },
      payment_method_collection: 'always',
      allow_promotion_codes: 'true',
      success_url: `${origin}/admin/settings?billing=success`,
      cancel_url: `${origin}/admin/settings?billing=cancelled`,
    })
    return { url: session.url }
  } catch (err) {
    console.error('[billing] checkout failed', err)
    return { error: friendlyStripeError(err) }
  }
}

async function loadSubscription(companyId: string): Promise<StripeSubscription | null> {
  const { data } = await createServiceRoleClient()
    .from('companies').select('stripe_subscription_id').eq('id', companyId).maybeSingle()
  if (!data?.stripe_subscription_id) return null
  return stripe<StripeSubscription>('GET', `/subscriptions/${data.stripe_subscription_id}`)
}

/**
 * Change plan and/or monthly↔annual on an existing subscription. Upgrades
 * are charged now, prorated for the days left; downgrades take effect now
 * without a refund and the lower price applies from the next bill.
 */
export async function changeSubscription(planKey: string, interval: string): Promise<{ error?: string }> {
  const user = requireAdmin()
  if (!user) return { error: 'Not authorized.' }
  if (!isPlanKey(planKey) || (interval !== 'month' && interval !== 'year')) return { error: 'Invalid plan.' }
  const companyId = user.company_id as string

  const fitError = await checkFitsPlan(companyId, planKey)
  if (fitError) return { error: fitError }

  try {
    const sub = await loadSubscription(companyId)
    if (!sub || sub.status === 'canceled') return { error: 'No active subscription. Choose a plan to subscribe.' }
    await ensureProducts()

    const planItem = sub.items.data.find(i => i.price.product !== SEAT_PRODUCT_ID)
    const seatItem = sub.items.data.find(i => i.price.product === SEAT_PRODUCT_ID)
    if (!planItem) return { error: 'Subscription has no plan item.' }

    const currentPlan = (sub.metadata?.plan_key && isPlanKey(sub.metadata.plan_key)) ? sub.metadata.plan_key : null
    const currentInterval = planItem.price.recurring?.interval ?? 'month'
    const isUpgrade =
      (currentPlan ? PLAN_ORDER.indexOf(planKey) > PLAN_ORDER.indexOf(currentPlan) : true) ||
      (interval === 'year' && currentInterval === 'month')

    const seats = seatsNeeded(planKey, await countFieldTeam(createClient(), companyId), seatItem?.quantity ?? 0)
    const items: Array<Record<string, unknown>> = [
      { id: planItem.id, price_data: planPriceData(planKey, interval as BillingInterval), quantity: 1 },
    ]
    if (seatItem) {
      items.push(seats > 0
        ? { id: seatItem.id, price_data: seatPriceData(planKey, interval as BillingInterval), quantity: seats }
        : { id: seatItem.id, deleted: 'true' })
    } else if (seats > 0) {
      items.push({ price_data: seatPriceData(planKey, interval as BillingInterval), quantity: seats })
    }

    const updated = await stripe<StripeSubscription>('POST', `/subscriptions/${sub.id}`, {
      items,
      metadata: { company_id: companyId, plan_key: planKey },
      proration_behavior: isUpgrade ? 'always_invoice' : 'none',
      cancel_at_period_end: 'false',
    })
    await syncCompanyFromSubscription(updated)
    return {}
  } catch (err) {
    console.error('[billing] change failed', err)
    return { error: friendlyStripeError(err) }
  }
}

/** How many people over the plan's included field team the company pays for. */
export async function setExtraSeats(count: number): Promise<{ error?: string }> {
  const user = requireAdmin()
  if (!user) return { error: 'Not authorized.' }
  const companyId = user.company_id as string
  const seats = Math.floor(Number(count))
  if (!Number.isFinite(seats) || seats < 0 || seats > 500) return { error: 'Invalid number.' }

  const supabase = createClient()
  const access = await getCompanyAccess(supabase, companyId)
  const used = await countFieldTeam(supabase, companyId)
  if (PLANS[access.planKey].fieldTeam + seats < used && !access.unlimited) {
    return { error: `You have ${used} people on the field team. Deactivate people first to go below that.` }
  }

  // No subscription yet (trial): saved, and added to the checkout later.
  if (!access.subscribed || access.state === 'canceled') {
    await createServiceRoleClient().from('companies').update({ extra_seats: seats }).eq('id', companyId)
    return {}
  }

  try {
    const sub = await loadSubscription(companyId)
    if (!sub) return { error: 'No subscription found.' }
    await ensureProducts()
    const seatItem = sub.items.data.find(i => i.price.product === SEAT_PRODUCT_ID)
    const planItem = sub.items.data.find(i => i.price.product !== SEAT_PRODUCT_ID)
    const interval = planItem?.price.recurring?.interval ?? 'month'

    let updated: StripeSubscription
    if (seatItem) {
      updated = await stripe<StripeSubscription>('POST', `/subscriptions/${sub.id}`, {
        items: [seats > 0 ? { id: seatItem.id, quantity: seats } : { id: seatItem.id, deleted: 'true' }],
        proration_behavior: 'create_prorations',
      })
    } else if (seats > 0) {
      updated = await stripe<StripeSubscription>('POST', `/subscriptions/${sub.id}`, {
        items: [{ price_data: seatPriceData(access.planKey, interval), quantity: seats }],
        proration_behavior: 'create_prorations',
      })
    } else {
      return {}
    }
    await syncCompanyFromSubscription(updated)
    return {}
  } catch (err) {
    console.error('[billing] seats failed', err)
    return { error: friendlyStripeError(err) }
  }
}

/** Stripe's Customer Portal: card, invoices, cancel. */
export async function openBillingPortal(): Promise<{ error?: string; url?: string }> {
  const user = requireAdmin()
  if (!user) return { error: 'Not authorized.' }
  if (!stripeConfigured()) return { error: 'Online payment is not set up yet.' }
  const { data } = await createServiceRoleClient()
    .from('companies').select('stripe_customer_id').eq('id', user.company_id as string).maybeSingle()
  if (!data?.stripe_customer_id) return { error: 'No billing account yet. Choose a plan first.' }
  try {
    const session = await stripe<{ url: string }>('POST', '/billing_portal/sessions', {
      customer: data.stripe_customer_id,
      return_url: `${appOrigin()}/admin/settings`,
    })
    return { url: session.url }
  } catch (err) {
    console.error('[billing] portal failed', err)
    return { error: friendlyStripeError(err) }
  }
}
