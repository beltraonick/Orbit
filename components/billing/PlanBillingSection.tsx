'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { PLANS, PLAN_ORDER, formatUsd, type BillingInterval, type PlanKey } from '@/lib/plans'
import {
  getBillingOverview, startCheckout, changeSubscription, setExtraSeats, openBillingPortal,
  type BillingOverview,
} from '@/app/actions/billing'

// Settings → Plan & Billing. Website only: the Settings page doesn't render
// this inside the iOS app (no prices or purchase there — App Store rules).

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), s)

export function PlanBillingSection() {
  const { t } = useTranslation()
  const b = (key: string, vars: Record<string, string | number> = {}) => fill(t(`admin.billing.${key}`), vars)

  const [overview, setOverview] = useState<BillingOverview | null>(null)
  const [interval, setInterval_] = useState<BillingInterval>('month')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [seats, setSeats] = useState('0')
  const [seatsSaved, setSeatsSaved] = useState(false)

  const load = useCallback(async () => {
    const res = await getBillingOverview()
    if (res.overview) {
      setOverview(res.overview)
      setSeats(String(res.overview.access.extraSeats))
      if (res.overview.access.interval) setInterval_(res.overview.access.interval)
    }
    return res.overview ?? null
  }, [])

  useEffect(() => { load() }, [load])

  // Back from Stripe: show a message, and after a successful checkout poll
  // until the webhook has recorded the subscription.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const flag = params.get('billing')
    if (!flag) return
    if (flag === 'success') setNotice(b('successMsg'))
    else if (flag === 'cancelled') setNotice(b('cancelledMsg'))
    else if (flag === 'upgrade') setNotice(b('upgradeMsg'))
    const url = new URL(window.location.href)
    url.searchParams.delete('billing')
    window.history.replaceState({}, '', url.toString())
    if (flag !== 'success') return
    let tries = 0
    const timer = window.setInterval(async () => {
      tries++
      const o = await load()
      if ((o?.access.subscribed && o.access.state !== 'canceled') || tries >= 8) window.clearInterval(timer)
    }, 3000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!overview) {
    return <Card><div className="h-16 bg-surface-elevated rounded-input animate-pulse" /></Card>
  }

  const { access } = overview
  const hasLiveSubscription = access.subscribed && access.state !== 'canceled'

  const statusBadge = {
    trial: <Badge variant="blue">{b('statusTrial')}</Badge>,
    active: <Badge variant="green">{b('statusActive')}</Badge>,
    past_due: <Badge variant="amber">{b('statusPastDue')}</Badge>,
    expired: <Badge variant="red">{b('statusExpired')}</Badge>,
    canceled: <Badge variant="red">{b('statusCanceled')}</Badge>,
  }[access.state]

  async function choose(plan: PlanKey) {
    setError('')
    if (hasLiveSubscription) {
      const isDowngrade = PLAN_ORDER.indexOf(plan) < PLAN_ORDER.indexOf(access.planKey)
      if (!window.confirm(b(isDowngrade ? 'confirmDowngrade' : 'confirmUpgrade', { plan: PLANS[plan].name }))) return
      setBusy(plan)
      const res = await changeSubscription(plan, interval)
      setBusy(null)
      if (res.error) setError(res.error)
      else await load()
      return
    }
    setBusy(plan)
    const res = await startCheckout(plan, interval)
    if (res.url) { window.location.href = res.url; return }
    setBusy(null)
    setError(res.error ?? 'Something went wrong.')
  }

  async function portal() {
    setError('')
    setBusy('portal')
    const res = await openBillingPortal()
    if (res.url) { window.location.href = res.url; return }
    setBusy(null)
    setError(res.error ?? 'Something went wrong.')
  }

  async function saveSeats() {
    setError('')
    setBusy('seats')
    const res = await setExtraSeats(Number(seats))
    setBusy(null)
    if (res.error) { setError(res.error); return }
    await load()
    setSeatsSaved(true)
    setTimeout(() => setSeatsSaved(false), 2000)
  }

  return (
    <Card>
      <div className="space-y-4">
        {/* Status */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="text-xs text-secondary uppercase tracking-wide mb-0.5">{b('currentPlan')}</p>
            <p className="text-base font-semibold text-primary">
              {access.state === 'trial' && !access.subscribed ? `${b('statusTrial')} · Pro` : PLANS[access.planKey].name}
              {hasLiveSubscription && access.interval && (
                <span className="text-secondary font-normal"> · {access.interval === 'year' ? b('annual') : b('monthly')}</span>
              )}
            </p>
          </div>
          {statusBadge}
        </div>

        {access.unlimited && <p className="text-xs text-secondary">{b('unlimited')}</p>}
        {access.state === 'trial' && access.trialDaysLeft != null && (
          <p className="text-sm text-secondary">
            {access.subscribed
              ? b('trialSubscribed', { plan: PLANS[access.planKey].name })
              : access.trialDaysLeft <= 1 ? b('trialLastDay') : b('trialDaysLeft', { n: access.trialDaysLeft })}
          </p>
        )}
        {access.state === 'past_due' && <p className="text-sm text-amber">{b('pastDueNote')}</p>}
        {access.blocked && <p className="text-sm text-danger">{b('blockedNote')}</p>}

        <p className="text-xs text-secondary">
          {overview.fieldTeamLimit != null
            ? b('teamUsage', { used: overview.fieldTeamUsed, limit: overview.fieldTeamLimit })
            : b('teamUsageUnlimited', { used: overview.fieldTeamUsed })}
          {overview.adminLimit != null && <> · {b('adminUsage', { used: overview.adminsUsed, limit: overview.adminLimit })}</>}
        </p>

        {notice && <div className="rounded-input bg-blue/10 border border-blue/20 px-3 py-2 text-sm text-primary">{notice}</div>}
        {!overview.stripeReady && <div className="rounded-input bg-amber/10 border border-amber/20 px-3 py-2 text-sm text-primary">{b('notSetUp')}</div>}
        {error && <div className="rounded-input bg-danger/10 border border-danger/20 px-3 py-2 text-sm text-danger">{error}</div>}

        {/* Monthly / annual */}
        <div className="inline-flex rounded-input border border-[var(--border)] p-0.5 bg-surface-elevated">
          {(['month', 'year'] as BillingInterval[]).map(iv => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval_(iv)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-[6px] transition-colors ${interval === iv ? 'bg-surface text-primary shadow-sm' : 'text-secondary'}`}
            >
              {iv === 'month' ? b('monthly') : <>{b('annual')} <span className="text-green">· {b('annualSave')}</span></>}
            </button>
          ))}
        </div>

        {/* Plans */}
        <div className="grid gap-3">
          {PLAN_ORDER.map(key => {
            const plan = PLANS[key]
            const price = interval === 'year' ? plan.annualCents : plan.monthlyCents
            const isCurrent = hasLiveSubscription && access.planKey === key && access.interval === interval
            const extra = Math.max(access.extraSeats, overview.fieldTeamUsed - plan.fieldTeam, 0)
            const extraPriceCents = extra * plan.extraSeatCents * (interval === 'year' ? 12 : 1)
            return (
              <div
                key={key}
                className={`rounded-input border px-4 py-3 ${plan.popular ? 'border-brand/50 bg-brand/5' : 'border-[var(--border)] bg-surface-elevated'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-primary">{plan.name}</span>
                      {plan.popular && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-brand bg-brand/15 px-1.5 py-0.5 rounded-full">
                          {b('mostPopular')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-secondary mt-1">{b(`features${plan.name}`)}</p>
                    <p className="text-xs text-tertiary mt-1">
                      {b('fieldTeam', { n: plan.fieldTeam })} ·{' '}
                      {plan.admins == null ? b('adminsUnlimited') : plan.admins === 1 ? b('adminsOne') : b('admins', { n: plan.admins })} ·{' '}
                      {b('extraPerson', { price: formatUsd(plan.extraSeatCents) })}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-base font-bold text-primary">{formatUsd(price)}</p>
                    <p className="text-[11px] text-secondary">{interval === 'year' ? b('perYear') : b('perMonth')}</p>
                  </div>
                </div>
                {extra > 0 && (
                  <p className="text-xs text-amber mt-2">
                    {b('extraNeeded', { used: overview.fieldTeamUsed, extra, price: `${formatUsd(extraPriceCents)}${interval === 'year' ? b('perYear') : b('perMonth')}` })}
                  </p>
                )}
                <Button
                  onClick={() => choose(key)}
                  variant={isCurrent ? 'secondary' : 'primary'}
                  disabled={isCurrent || !!busy || !overview.stripeReady || access.unlimited}
                  loading={busy === key}
                  className="w-full mt-3"
                >
                  {isCurrent ? b('current') : hasLiveSubscription ? b('switchTo', { plan: plan.name }) : b('choose', { plan: plan.name })}
                </Button>
              </div>
            )
          })}
        </div>

        {/* Extra people + Stripe portal (only once there's a subscription) */}
        {hasLiveSubscription && (
          <div className="space-y-3 border-t border-[var(--border)] pt-4">
            <div>
              <label className="text-sm font-medium text-secondary">{b('extraSeats')}</label>
              <div className="flex gap-2 mt-1">
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={seats}
                  onChange={e => setSeats(e.target.value)}
                  className="w-24 bg-surface border border-[var(--border)] rounded-input px-3 py-2 text-sm text-primary"
                />
                <Button variant="secondary" onClick={saveSeats} loading={busy === 'seats'} disabled={!!busy}>
                  {seatsSaved ? `✓ ${b('saved')}` : b('save')}
                </Button>
              </div>
              <p className="text-xs text-tertiary mt-1">{b('extraSeatsHint', { price: formatUsd(PLANS[access.planKey].extraSeatCents) })}</p>
            </div>
            <Button variant="secondary" onClick={portal} loading={busy === 'portal'} disabled={!!busy} className="w-full">
              {b('manageBilling')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  )
}
