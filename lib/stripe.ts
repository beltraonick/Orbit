import 'server-only'
import { createHmac, timingSafeEqual } from 'crypto'
import { PLANS, type BillingInterval, type PlanKey } from '@/lib/plans'

// Minimal Stripe client over its REST API (no SDK). Needs STRIPE_SECRET_KEY;
// the webhook also needs STRIPE_WEBHOOK_SECRET. Prices come from lib/plans.ts
// and are sent inline (price_data) on fixed product ids, so nothing has to be
// set up by hand in the Stripe dashboard except the webhook endpoint and the
// customer portal.

// STRIPE_API_BASE is only for local tests against a fake Stripe.
const API = process.env.STRIPE_API_BASE || 'https://api.stripe.com/v1'

export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

type Params = Record<string, unknown>

// Stripe takes form-encoded bodies with bracketed keys: a[b][0][c]=x.
function encode(params: Params, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') out.push(...encode(item as Params, `${key}[${i}]`))
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)
      })
    } else if (typeof v === 'object') {
      out.push(...encode(v as Params, key))
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`)
    }
  }
  return out
}

export class StripeError extends Error {
  constructor(message: string, public code?: string, public status?: number) {
    super(message)
    this.name = 'StripeError'
  }
}

export async function stripe<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Params = {},
): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new StripeError('Stripe is not configured (STRIPE_SECRET_KEY).')
  const body = encode(params).join('&')
  const url = method === 'GET' && body ? `${API}${path}?${body}` : `${API}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-06-20',
    },
    body: method === 'GET' ? undefined : body,
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } }).error
    throw new StripeError(err?.message ?? `Stripe request failed (${res.status})`, err?.code, res.status)
  }
  return json as T
}

// ── Products (created once, with fixed ids) ────────────────────────────────
export const SEAT_PRODUCT_ID = 'orbitops_extra_person'
export function planProductId(plan: PlanKey): string {
  return `orbitops_plan_${plan}`
}

async function ensureProduct(id: string, name: string): Promise<void> {
  try {
    await stripe('GET', `/products/${id}`)
  } catch (err) {
    if (err instanceof StripeError && err.status === 404) {
      try {
        await stripe('POST', '/products', { id, name })
      } catch (e) {
        // Created by a concurrent request in the meantime.
        if (!(e instanceof StripeError && e.code === 'resource_already_exists')) throw e
      }
    } else {
      throw err
    }
  }
}

export async function ensureProducts(): Promise<void> {
  await Promise.all([
    ...Object.values(PLANS).map(p => ensureProduct(planProductId(p.key), `OrbitOps ${p.name}`)),
    ensureProduct(SEAT_PRODUCT_ID, 'OrbitOps extra person'),
  ])
}

export function planPriceData(plan: PlanKey, interval: BillingInterval) {
  const def = PLANS[plan]
  return {
    currency: 'usd',
    product: planProductId(plan),
    unit_amount: interval === 'year' ? def.annualCents : def.monthlyCents,
    recurring: { interval },
  }
}

export function seatPriceData(plan: PlanKey, interval: BillingInterval) {
  const monthly = PLANS[plan].extraSeatCents
  return {
    currency: 'usd',
    product: SEAT_PRODUCT_ID,
    unit_amount: interval === 'year' ? monthly * 12 : monthly,
    recurring: { interval },
  }
}

// ── Webhook signature (Stripe-Signature: t=...,v1=...) ──────────────────────
export function verifyWebhookSignature(payload: string, header: string | null, toleranceSec = 300): boolean {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !header) return false
  const parts = header.split(',').map(p => p.trim())
  const t = parts.find(p => p.startsWith('t='))?.slice(2)
  const sigs = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3))
  if (!t || sigs.length === 0) return false
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')
  const exp = Buffer.from(expected)
  return sigs.some(s => {
    const got = Buffer.from(s)
    return got.length === exp.length && timingSafeEqual(got, exp)
  })
}

// ── Subscription shape we read ──────────────────────────────────────────────
export interface StripeSubscription {
  id: string
  customer: string
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused'
  trial_end: number | null
  current_period_end: number | null
  cancel_at_period_end: boolean
  metadata: Record<string, string>
  items: {
    data: Array<{
      id: string
      quantity: number
      price: { id: string; product: string; recurring: { interval: BillingInterval } | null }
    }>
  }
}
