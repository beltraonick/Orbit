'use client'

import { useState, useEffect } from 'react'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { approvePay, getMyPayApproval, type PayApproval } from '@/app/actions/payApprovalActions'

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const fmtDate = (iso: string) =>
  new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

interface Props {
  periodStart: string
  periodEnd: string
  /** Total the employee sees on screen for this period. */
  amount: number
  /** Days (day-rate) or hours (hourly), as shown on screen. */
  quantity: number
  isDailyRate: boolean
  /** true once the period's last day is over (company local date). */
  periodEnded: boolean
}

// "Approve payment" on the Pay screen: the employee confirms the days and
// amount of the period being paid. Can't be undone; if the amount changes
// afterwards, they're asked to approve the new amount.
export function PayApprovalCard({ periodStart, periodEnd, amount, quantity, isDailyRate, periodEnded }: Props) {
  const { t } = useTranslation()
  const [approval, setApproval] = useState<PayApproval | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'setup' | 'paid'>('loading')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setError('')
    getMyPayApproval(periodStart, periodEnd).then(res => {
      if (cancelled) return
      if ('setupNeeded' in res) { setState('setup'); return }
      setApproval('approval' in res ? res.approval ?? null : null)
      setState('ready')
    })
    return () => { cancelled = true }
  }, [periodStart, periodEnd])

  const quantityLabel = isDailyRate
    ? t('schedule.pay.daysCount').replace('{n}', quantity % 1 === 0 ? String(quantity) : quantity.toFixed(1))
    : t('schedule.pay.hoursCount').replace('{n}', quantity.toFixed(1))

  async function handleApprove() {
    setSaving(true)
    setError('')
    const res = await approvePay({ periodStart, periodEnd, amount, daysWorked: quantity })
    setSaving(false)
    setConfirming(false)
    if ('ok' in res && res.ok) { setApproval(res.approval); return }
    const code = 'error' in res ? res.error : ''
    if (code === 'already_paid') { setState('paid'); return }
    if (code === 'setup_needed') { setState('setup'); return }
    if (code === 'not_ended') { setError(t('schedule.pay.notEnded').replace('{date}', fmtDate(periodEnd))); return }
    setError(t('schedule.pay.error'))
  }

  if (state === 'loading') return null

  if (state === 'setup') {
    return (
      <div className="mb-6 px-4 py-3 rounded-card border border-[var(--border)] bg-surface text-xs text-secondary">
        {t('schedule.pay.setupNeeded')}
      </div>
    )
  }

  if (state === 'paid') {
    return (
      <div className="mb-6 px-4 py-3 rounded-card border border-green/20 bg-green/10 text-sm text-green">
        {t('schedule.pay.alreadyPaid')}
      </div>
    )
  }

  const approvedSameAmount = approval && Math.abs(approval.amount - amount) < 0.005

  if (approvedSameAmount) {
    return (
      <div className="mb-6 px-4 py-3.5 rounded-card border border-green/20 bg-green/10 flex items-start gap-3">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-green flex-shrink-0 mt-0.5">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-green">{t('schedule.pay.approvedTitle')}</p>
          <p className="text-xs text-secondary mt-0.5">
            {t('schedule.pay.approvedOn').replace('{amount}', fmt(approval!.amount)).replace('{date}', fmtDate(approval!.approved_at))}
          </p>
        </div>
      </div>
    )
  }

  if (!periodEnded) {
    return (
      <div className="mb-6 px-4 py-3 rounded-card border border-[var(--border)] bg-surface text-xs text-secondary">
        {t('schedule.pay.notEnded').replace('{date}', fmtDate(periodEnd))}
      </div>
    )
  }

  return (
    <>
      <div className="mb-6 px-4 py-4 rounded-card border border-brand/25 bg-brand/5">
        {approval ? (
          <>
            <p className="text-sm font-semibold text-amber">{t('schedule.pay.changedTitle')}</p>
            <p className="text-xs text-secondary mt-1">
              {t('schedule.pay.changedBody').replace('{old}', fmt(approval.amount)).replace('{new}', fmt(amount))}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-primary">{t('schedule.pay.approveTitle')}</p>
            <p className="text-xs text-secondary mt-1">{t('schedule.pay.approveBody')}</p>
          </>
        )}
        {error && <p className="text-xs text-danger mt-2">{error}</p>}
        <button
          type="button"
          onClick={() => { setError(''); setConfirming(true) }}
          className="mt-3 w-full h-11 rounded-button bg-brand text-white text-sm font-semibold hover:opacity-90 transition-opacity"
        >
          {t('schedule.pay.approveButton')} · {fmt(amount)}
        </button>
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center"
          onClick={() => !saving && setConfirming(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full md:max-w-sm bg-surface rounded-t-[20px] md:rounded-[20px] p-5"
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-primary">{t('schedule.pay.confirmTitle')}</h3>
            <p className="text-sm text-secondary mt-2">
              {t('schedule.pay.confirmBody').replace('{days}', quantityLabel).replace('{amount}', fmt(amount))}
            </p>
            <div className="flex gap-2 mt-5">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={saving}
                className="flex-1 h-11 rounded-button border border-[var(--border)] text-sm font-medium text-primary bg-surface disabled:opacity-50"
              >
                {t('schedule.cancel')}
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={saving}
                className="flex-1 h-11 rounded-button bg-brand text-white text-sm font-semibold disabled:opacity-50"
              >
                {saving ? '…' : t('schedule.pay.confirmYes')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
