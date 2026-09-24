'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { Card } from '@/components/ui/Card'
import { cancelDayOffRequest, getMyDaysOff, requestDayOff } from '@/app/actions/scheduleActions'

type Data = Extract<Awaited<ReturnType<typeof getMyDaysOff>>, { ok: true }>

const fmtLong = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

// Employee: see fixed and upcoming days off, ask for a day off, and follow
// the answer. The company approves or declines in Admin → Days Off.
export function MyDaysOff() {
  const { t } = useTranslation()
  const [data, setData] = useState<Data | null>(null)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    const res = await getMyDaysOff()
    if ('setupNeeded' in res) { setSetupNeeded(true); return }
    if ('error' in res) { setLoadError(true); return }
    setData(res)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!date) return
    setSending(true)
    setMessage(null)
    const res = await requestDayOff(date, reason)
    setSending(false)
    if ('ok' in res) {
      setMessage({ ok: true, text: t('schedule.employee.sent') })
      setDate('')
      setReason('')
      await load()
      return
    }
    const text = res.error === 'past' ? t('schedule.employee.errPast')
      : res.error === 'duplicate' ? t('schedule.employee.errDuplicate')
      : res.error.includes('migration 048') ? t('schedule.employee.setupNeeded')
      : t('schedule.employee.error')
    setMessage({ ok: false, text })
  }

  async function handleCancel(id: string) {
    await cancelDayOffRequest(id)
    await load()
  }

  const statusStyle = {
    pending: 'bg-surface-elevated text-secondary border border-[var(--border)]',
    approved: 'bg-green/10 text-green',
    declined: 'bg-danger/10 text-danger',
  } as const

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <h1 className="text-xl font-bold text-primary mb-5">{t('schedule.employee.title')}</h1>

      {setupNeeded && (
        <div className="px-4 py-3 rounded-card border border-[var(--border)] bg-surface text-sm text-secondary">
          {t('schedule.employee.setupNeeded')}
        </div>
      )}
      {loadError && (
        <div className="px-4 py-3 rounded-card bg-danger/10 border border-danger/20 text-sm text-danger">
          {t('schedule.employee.error')}
        </div>
      )}

      {data && (
        <>
          {/* Fixed + upcoming */}
          <Card className="mb-4">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t('schedule.employee.fixedTitle')}</p>
            <p className="text-base font-semibold text-primary">
              {data.weeklyDaysOff.length > 0
                ? data.weeklyDaysOff.map(d => t(`schedule.weekday.${d}`)).join(', ')
                : t('schedule.employee.fixedNone')}
            </p>
            <p className="text-xs text-secondary uppercase tracking-wide mt-4 mb-1.5">{t('schedule.employee.upcomingTitle')}</p>
            {data.overrides.length === 0 ? (
              <p className="text-sm text-secondary">{t('schedule.employee.upcomingNone')}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {data.overrides.map(o => (
                  <div key={o.date} className="flex items-center justify-between text-sm">
                    <span className="text-primary">{fmtLong(o.date)}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${o.off ? 'bg-amber/10 text-amber' : 'bg-green/10 text-green'}`}>
                      {o.off ? t('schedule.employee.extraOff') : t('schedule.employee.extraWork')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Ask for a day off */}
          <Card className="mb-4">
            <h2 className="text-sm font-semibold text-primary mb-3">{t('schedule.employee.requestTitle')}</h2>
            <form onSubmit={handleSend} className="flex flex-col gap-3">
              <label className="text-xs font-medium text-secondary">
                {t('schedule.employee.dateLabel')}
                <input
                  type="date"
                  required
                  min={data.today}
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="mt-1 w-full text-sm rounded-button border border-[var(--border)] px-3 py-2.5 bg-surface text-primary"
                />
              </label>
              <label className="text-xs font-medium text-secondary">
                {t('schedule.employee.reasonLabel')}
                <textarea
                  rows={2}
                  maxLength={500}
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  className="mt-1 w-full text-sm rounded-button border border-[var(--border)] px-3 py-2.5 bg-surface text-primary resize-none"
                />
              </label>
              {message && (
                <p className={`text-sm ${message.ok ? 'text-green' : 'text-danger'}`}>{message.text}</p>
              )}
              <button
                type="submit"
                disabled={sending || !date}
                className="h-11 rounded-button bg-brand text-white text-sm font-semibold disabled:opacity-50"
              >
                {sending ? '…' : t('schedule.employee.send')}
              </button>
            </form>
          </Card>

          {/* My requests */}
          {data.requests.length > 0 && (
            <Card padding="none">
              <div className="px-5 py-3.5 border-b border-[var(--border)]">
                <h2 className="text-sm font-semibold text-primary">{t('schedule.employee.myRequests')}</h2>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {data.requests.map(r => (
                  <div key={r.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary">{fmtLong(r.date)}</p>
                      {r.reason && <p className="text-xs text-secondary truncate">{r.reason}</p>}
                    </div>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusStyle[r.status]}`}>
                      {t(`schedule.employee.${r.status}`)}
                    </span>
                    {r.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => handleCancel(r.id)}
                        className="text-xs text-secondary hover:text-danger"
                      >
                        {t('schedule.employee.cancelRequest')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
