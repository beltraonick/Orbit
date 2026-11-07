import { stripe, verifyWebhookSignature, type StripeSubscription } from '@/lib/stripe'
import { syncCompanyFromSubscription } from '@/lib/billing-sync'

// Stripe → OrbitOps. Configure in Stripe: Developers → Webhooks → endpoint
// https://<app>/api/billing/webhook, events checkout.session.completed and
// customer.subscription.created/updated/deleted. Its signing secret goes in
// STRIPE_WEBHOOK_SECRET. Every event re-reads the subscription from Stripe,
// so out-of-order deliveries still end in the current state.
export const dynamic = 'force-dynamic'

interface StripeEvent {
  type: string
  data: { object: { id: string; object: string; subscription?: string | null } }
}

export async function POST(req: Request) {
  const payload = await req.text()
  if (!verifyWebhookSignature(payload, req.headers.get('stripe-signature'))) {
    return new Response('Invalid signature', { status: 400 })
  }

  let event: StripeEvent
  try {
    event = JSON.parse(payload)
  } catch {
    return new Response('Invalid payload', { status: 400 })
  }

  let subscriptionId: string | null = null
  if (event.type === 'checkout.session.completed') subscriptionId = event.data.object.subscription ?? null
  else if (event.type.startsWith('customer.subscription.')) subscriptionId = event.data.object.id
  else if (event.type.startsWith('invoice.')) subscriptionId = event.data.object.subscription ?? null

  if (!subscriptionId) return Response.json({ received: true })

  try {
    const sub = await stripe<StripeSubscription>('GET', `/subscriptions/${subscriptionId}`)
    await syncCompanyFromSubscription(sub)
  } catch (err) {
    console.error('[billing] webhook sync failed', event.type, err)
    // 500 makes Stripe retry later.
    return new Response('Sync failed', { status: 500 })
  }

  return Response.json({ received: true })
}
