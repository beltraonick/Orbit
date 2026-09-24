'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { decideDayOffRequest, getWeekSchedule, setDayOff, setWeeklyDaysOff } from '@/app/actions/scheduleActions'
import { addDays, dayOfWeek, weekStartOf } from '@/lib/schedule'
import { toDateStr } from '@/lib/employee-period'

type WeekData = Extract<Awaited<ReturnType<typeof getWeekSchedule>>, { ok: true }>
type Employee = WeekData['employees'][number]

const fmtDay = (d: string) => Number(d.slice(8, 10))
const fmtRange = (start: string, end: string) => {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${new Date(start + 'T12:00:00').toLocaleDateString('en-US', opts)} – ${new Date(end + 'T12:00:00').toLocaleDateString('en-US', opts)}`
}
const fmtLong = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

const WEEK = [0, 1, 2, 3, 4, 5, 6]

// Admin "Days Off": fixed weekly days off per employee, a week view where
// any single day can be switched between work and day off, and the
// employees' day-off requests to approve or decline.
export function ScheduleManager() {
  const { t } = useTranslation()
  const router = useRouter()
  const [weekStart, setWeekStart] = useState(() => weekStartOf(toDateStr(new Date())))
  const [data, setData] = useState<WeekData | null>(null)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // key of the cell/request being saved
  const [editing, setEditing] = useState<{ id: string; days: number[] } | null>(null)

  const load = useCallback(async () => {
    const res = await getWeekSchedule(weekStart)
    setLoading(false)
    if ('setupNeeded' in res) { setSetupNeeded(true); return }
    if ('error' in res) { setError(t('schedule.admin.error')); return }
    setData(res)
  }, [weekStart, t])

  useEffect(() => { setLoading(true); load() }, [load])

  async function run(key: string, action: () => Promise<{ error: string } | { ok: boolean }>) {
    setBusy(key)
    setError('')
    const res = await action()
    if ('error' in res) setError(res.error.includes('migration 048') ? t('schedule.admin.setupNeeded') : t('schedule.admin.error'))
    await load()
    setBusy(null)
    // Menu badges (pending requests) come from the layout.
    router.refresh()
  }

  const toggleDay = (emp: Employee, date: string, off: boolean) =>
    run(`${emp.id}|${date}`, () => setDayOff(emp.id, date, !off))

  const decide = (id: string, approve: boolean) =>
    run(`req|${id}`, () => decideDayOffRequest(id, approve))

  const saveFixed = () => {
    if (!editing) return
    const { id, days } = editing
    setEditing(null)
    return run(`fixed|${id}`, () => setWeeklyDaysOff(id, days))
  }

  const weekEnd = addDays(weekStart, 6)
  const thisWeek = weekStartOf(toDateStr(new Date()))

  return (
    <div className="p-4 md:p-8 max-w-3xl">
      <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{t('schedule.admin.title')}</h1>
      <p className="text-sm text-secondary mt-1 mb-5">{t('schedule.admin.subtitle')}</p>

      {setupNeeded && (
        <div className="px-4 py-3 rounded-card bg-amber/10 border border-amber/20 text-sm text-amber">
          {t('schedule.admin.setupNeeded')}
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-2.5 rounded-button bg-danger/10 border border-danger/20 text-danger text-sm">{error}</div>
      )}

      {/* Pending requests */}
      {data && data.requests.length > 0 && (
        <div className="mb-6 border border-brand/25 rounded-card overflow-hidden bg-surface">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-brand/5">
            <h2 className="text-sm font-semibold text-primary">
              {t('schedule.admin.requestsTitle')} · {data.requests.length}
            </h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {data.requests.map(r => (
              <div key={r.id} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary truncate">{r.employee_name}</p>
                  <p className="text-xs text-secondary">{fmtLong(r.date)}{r.reason ? ` · ${r.reason}` : ''}</p>
                </div>
                <button
                  type="button"
                  onClick={() => decide(r.id, false)}
                  disabled={busy !== null}
                  className="h-9 px-3 rounded-button border border-[var(--border)] text-xs font-medium text-secondary bg-surface disabled:opacity-50"
                >
                  {t('schedule.admin.decline')}
                </button>
                <button
                  type="button"
                  onClick={() => decide(r.id, true)}
                  disabled={busy !== null}
                  className="h-9 px-3 rounded-button bg-green text-white text-xs font-semibold disabled:opacity-50"
                >
                  {busy === `req|${r.id}` ? '…' : t('schedule.admin.approve')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Week navigation */}
      {!setupNeeded && (
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => setWeekStart(w => addDays(w, -7))}
            aria-label={t('schedule.admin.prevWeek')}
            className="w-9 h-9 rounded-button border border-[var(--border)] bg-surface text-secondary flex items-center justify-center"
          >
            ‹
          </button>
          <span className="text-sm font-semibold text-primary min-w-[130px] text-center">{fmtRange(weekStart, weekEnd)}</span>
          <button
            type="button"
            onClick={() => setWeekStart(w => addDays(w, 7))}
            aria-label={t('schedule.admin.nextWeek')}
            className="w-9 h-9 rounded-button border border-[var(--border)] bg-surface text-secondary flex items-center justify-center"
          >
            ›
          </button>
          {weekStart !== thisWeek && (
            <button
              type="button"
              onClick={() => setWeekStart(thisWeek)}
              className="ml-1 h-9 px-3 rounded-button text-xs font-medium text-brand hover:bg-brand/10"
            >
              {t('schedule.admin.thisWeek')}
            </button>
          )}
        </div>
      )}

      {loading && !data && !setupNeeded && <p className="text-sm text-secondary py-6">…</p>}

      {data && data.employees.length === 0 && (
        <p className="text-sm text-secondary py-6">{t('schedule.admin.noEmployees')}</p>
      )}

      {/* One card per employee */}
      {data && (
        <div className={`flex flex-col gap-3 ${loading ? 'opacity-60' : ''}`}>
          {data.employees.map(emp => {
            const isEditing = editing?.id === emp.id
            return (
              <div key={emp.id} className="bg-surface border border-[var(--border)] rounded-card p-3.5">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <p className="text-sm font-semibold text-primary truncate">{emp.full_name}</p>
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={() => setEditing({ id: emp.id, days: emp.weekly_days_off })}
                      disabled={busy !== null}
                      className="flex-shrink-0 text-xs text-secondary hover:text-brand disabled:opacity-50"
                    >
                      {t('schedule.admin.fixed')}:{' '}
                      <span className="font-medium text-primary">
                        {emp.weekly_days_off.length > 0
                          ? emp.weekly_days_off.map(d => t(`schedule.weekday.${d}`)).join(', ')
                          : t('schedule.admin.fixedNone')}
                      </span>
                      {' · '}<span className="text-brand font-medium">{t('schedule.admin.edit')}</span>
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <div>
                    <p className="text-xs text-secondary mb-2">{t('schedule.admin.fixed')}</p>
                    <div className="grid grid-cols-7 gap-1.5">
                      {WEEK.map(d => {
                        const on = editing!.days.includes(d)
                        return (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setEditing(e => e && ({ ...e, days: on ? e.days.filter(x => x !== d) : [...e.days, d] }))}
                            className={`h-10 rounded-button text-xs font-semibold border transition-colors ${
                              on ? 'bg-amber text-white border-amber' : 'bg-surface text-secondary border-[var(--border)]'
                            }`}
                          >
                            {t(`schedule.weekday.${d}`)}
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                        className="flex-1 h-9 rounded-button border border-[var(--border)] text-xs font-medium text-secondary bg-surface"
                      >
                        {t('schedule.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={saveFixed}
                        className="flex-1 h-9 rounded-button bg-brand text-white text-xs font-semibold"
                      >
                        {t('schedule.admin.save')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-1.5">
                    {emp.week.map(day => {
                      const key = `${emp.id}|${day.date}`
                      const isToday = day.date === data.today
                      return (
                        <button
                          key={day.date}
                          type="button"
                          onClick={() => toggleDay(emp, day.date, day.off)}
                          disabled={busy !== null}
                          aria-pressed={day.off}
                          className={`relative h-14 rounded-button border flex flex-col items-center justify-center transition-colors disabled:cursor-wait ${
                            day.off
                              ? 'bg-amber/15 border-amber/40 text-amber'
                              : 'bg-surface border-[var(--border)] text-primary'
                          } ${isToday ? 'ring-2 ring-brand/50' : ''} ${busy === key || busy === `fixed|${emp.id}` ? 'opacity-50' : ''}`}
                        >
                          <span className="text-[10px] font-medium opacity-70">{t(`schedule.weekdayShort.${dayOfWeek(day.date)}`)}</span>
                          <span className="text-sm font-semibold leading-tight">{fmtDay(day.date)}</span>
                          {day.off && <span className="text-[9px] font-bold uppercase leading-none mt-0.5">{t('schedule.admin.off')}</span>}
                          {day.changed && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-brand" />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {data && data.employees.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4 text-[11px] text-secondary">
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber/15 border border-amber/40" />{t('schedule.admin.legendOff')}</span>
          <span className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-brand" />{t('schedule.admin.legendChanged')}</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded ring-2 ring-brand/50" />{t('schedule.admin.legendToday')}</span>
        </div>
      )}
    </div>
  )
}
