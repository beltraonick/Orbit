'use client'

import { usePersistentState, oneOf } from '@/lib/use-persistent-state'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { calcEntryPay } from '@/lib/payroll-calc'
import { getFinalizedPayrollPeriod } from '@/app/actions/payrollActions'
import { useCompanyId } from '@/lib/company-context'
import { getPeriodRange, loadCompanyPeriodSettings, toDateStr, type CompanyPeriodSettings } from '@/lib/employee-period'

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const fmtDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })

// Normalized shape both the live (time_entries) and finalized
// (payroll_period_entries) sources map into, so the render logic below
// never needs to know which source a row came from.
interface DisplayEntry {
  id: string
  date: string
  projectName: string | null
  hours: number | null
  fullDay: boolean | null
  amount: number
}

interface Props {
  profileId: string
  hourlyRate: number
  dailyRate: number | null
}

export function PagamentoPeriodFilter({ profileId, hourlyRate, dailyRate }: Props) {
  const { t } = useTranslation()
  const isDailyRate = dailyRate != null && dailyRate > 0

  const [preset, setPreset] = usePersistentState<'current' | 'custom'>('pay.preset', 'current', oneOf(['current', 'custom'] as const))
  const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  const [customStart, setCustomStart] = usePersistentState<string>('pay.customStart', '', isDate)
  const [customEnd, setCustomEnd] = usePersistentState<string>('pay.customEnd', '', isDate)
  const [entries, setEntries] = useState<DisplayEntry[]>([])
  const [loading, setLoading] = useState(true)
  // A finalized period's numbers are frozen (Payroll tab -> Finalize
  // Payroll) — they can never disagree with what was actually paid, so this
  // screen shows them as-is instead of recomputing from live rates.
  const [finalized, setFinalized] = useState(false)

  // Same company pay period the admin sets (Settings → Pay Period).
  const companyId = useCompanyId()
  const [periodSettings, setPeriodSettings] = useState<CompanyPeriodSettings | null>(null)
  useEffect(() => {
    loadCompanyPeriodSettings(createClient(), companyId).then(setPeriodSettings)
  }, [companyId])
  const currentRange = periodSettings
    ? getPeriodRange(periodSettings.periodType, new Date(), periodSettings.anchor)
    : null
  const periodStart = preset === 'custom' ? customStart : (currentRange ? toDateStr(currentRange.start) : '')
  const periodEnd = preset === 'custom' ? customEnd : (currentRange ? toDateStr(currentRange.end) : '')

  const load = useCallback(async () => {
    if (!periodStart || !periodEnd) return
    setLoading(true)

    const snapshot = await getFinalizedPayrollPeriod(periodStart, periodEnd)
    if (snapshot.finalized) {
      setFinalized(true)
      setEntries(
        snapshot.entries
          .filter(e => e.person_id === profileId)
          .map((e): DisplayEntry => ({
            id: e.id,
            date: e.entry_date,
            projectName: e.project_name,
            hours: e.hours_worked != null ? Number(e.hours_worked) : null,
            fullDay: e.pay_mode === 'daily' ? e.full_day : null,
            amount: Number(e.total_pay) + Number(e.overtime_pay),
          }))
      )
      setLoading(false)
      return
    }
    setFinalized(false)

    const supabase = createClient()
    const { data } = await supabase
      .from('time_entries')
      .select('id, clock_in, clock_out, is_full_day, notes, project:project_id(name)')
      .eq('employee_id', profileId)
      .not('clock_out', 'is', null)
      .gte('clock_in', new Date(periodStart + 'T00:00:00').toISOString())
      .lte('clock_in', new Date(periodEnd + 'T23:59:59').toISOString())
      .order('clock_in', { ascending: false })

    type RawEntry = {
      id: string; clock_in: string; clock_out: string
      hours_worked: number | null; is_full_day: boolean | null
      project: { name: string } | null
    }
    const built = ((data ?? []) as unknown as RawEntry[]).map((e): DisplayEntry => {
      const calc = calcEntryPay({
        clock_in: e.clock_in,
        clock_out: e.clock_out,
        hours_worked: e.hours_worked != null ? Number(e.hours_worked) : null,
        is_full_day: e.is_full_day,
        daily_rate: dailyRate,
        hourly_rate: hourlyRate,
      })
      return {
        id: e.id,
        date: e.clock_in.slice(0, 10),
        projectName: e.project?.name ?? null,
        hours: calc.hoursWorked,
        fullDay: isDailyRate ? calc.fullDay : null,
        amount: calc.totalPay,
      }
    })
    setEntries(built)
    setLoading(false)
  }, [profileId, periodStart, periodEnd, dailyRate, hourlyRate, isDailyRate])

  useEffect(() => { load() }, [load])

  const totalEarnings = entries.reduce((s, e) => s + e.amount, 0)
  const totalHours = entries.reduce((s, e) => s + (e.hours ?? 0), 0)
  const fullDaysCount = entries.reduce((s, e) => s + (e.fullDay === true ? 1 : 0), 0)
  const halfDaysCount = entries.reduce((s, e) => s + (e.fullDay === false ? 1 : 0), 0)
  const totalDays = isDailyRate ? fullDaysCount + halfDaysCount * 0.5 : 0

  const earningsLabel = t(finalized ? 'employee.pagamento.paidEarnings' : 'employee.pagamento.estEarnings')
  const daysHoursLabel = t(isDailyRate ? 'employee.pagamento.daysWorkedLabel' : 'employee.pagamento.hoursWorkedLabel')
  const daysBreakdown = isDailyRate && (fullDaysCount > 0 || halfDaysCount > 0)
    ? [
        fullDaysCount > 0 ? t(fullDaysCount === 1 ? 'employee.pagamento.fullDaySingular' : 'employee.pagamento.fullDayPlural').replace('{n}', String(fullDaysCount)) : null,
        halfDaysCount > 0 ? t(halfDaysCount === 1 ? 'employee.pagamento.halfDaySingular' : 'employee.pagamento.halfDayPlural').replace('{n}', String(halfDaysCount)) : null,
      ].filter(Boolean).join(' • ')
    : null

  const PRESET_OPTIONS = [
    { value: 'current', label: t('employee.pagamento.currentPeriod') },
    { value: 'custom',  label: t('employee.pagamento.customPeriod') },
  ]

  return (
    <div>
      {/* Period selector */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="flex rounded-button border border-[var(--border)] overflow-hidden">
          {PRESET_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setPreset(opt.value as typeof preset)}
              className={`flex-1 sm:flex-none px-3 py-2 text-sm transition-colors ${
                preset === opt.value
                  ? 'bg-brand text-white'
                  : 'text-secondary hover:text-primary bg-surface'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="text-sm rounded-button border border-[var(--border)] px-2.5 py-2 bg-surface text-primary flex-1"
            />
            <span className="text-secondary text-sm">→</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="text-sm rounded-button border border-[var(--border)] px-2.5 py-2 bg-surface text-primary flex-1"
            />
          </div>
        )}
      </div>

      {/* Summary cards — label itself carries the Estimated/Paid distinction,
          so there's no need for a separate status badge above it. */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card>
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">
            {earningsLabel}
          </p>
          <p className="text-2xl font-bold text-primary">
            {loading ? '—' : totalEarnings > 0 ? fmt(totalEarnings) : '—'}
          </p>
          {!loading && !isDailyRate && totalHours > 0 && (
            <p className="text-xs text-secondary mt-1">
              {t('employee.pagamento.hoursWorked').replace('{n}', totalHours.toFixed(1))}
            </p>
          )}
        </Card>
        <Card>
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">
            {daysHoursLabel}
          </p>
          <p className="text-2xl font-bold text-primary">
            {loading
              ? '—'
              : isDailyRate
                ? (totalDays > 0 ? (totalDays % 1 === 0 ? totalDays : totalDays.toFixed(1)) : '—')
                : (totalHours > 0 ? totalHours.toFixed(1) : '—')}
          </p>
          {!loading && daysBreakdown && (
            <p className="text-xs text-secondary mt-1 leading-snug">{daysBreakdown}</p>
          )}
        </Card>
      </div>

      {/* Entry list */}
      {!loading && entries.length > 0 && (
        <Card padding="none" className="mb-6">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-semibold text-primary">{t('employee.pagamento.recentEntries')}</h3>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {entries.map(e => {
              const dayLabel = e.fullDay != null
                ? (e.fullDay ? t('employee.pagamento.fullDay') : t('employee.pagamento.halfDay'))
                : null
              return (
                <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-primary">{fmtDate(e.date)}</p>
                    <p className="text-xs text-secondary mt-0.5 truncate">
                      {e.projectName ?? '—'}
                      {dayLabel ? '' : ` · ${(e.hours ?? 0).toFixed(1)}h`}
                    </p>
                  </div>
                  {dayLabel ? (
                    <div className={`flex flex-col items-end px-2.5 py-1 rounded-lg flex-shrink-0 ${e.fullDay ? 'bg-green/10' : 'bg-purple/10'}`}>
                      <span className={`text-sm font-semibold tabular-nums ${e.fullDay ? 'text-green' : 'text-purple'}`}>
                        {fmt(e.amount)}
                      </span>
                      <span className={`text-[10px] font-medium ${e.fullDay ? 'text-green' : 'text-purple'}`}>
                        {dayLabel}
                      </span>
                    </div>
                  ) : (
                    <span className="text-sm font-semibold text-primary tabular-nums flex-shrink-0">
                      {fmt(e.amount)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {!loading && entries.length === 0 && (
        <div className="text-center py-10 border-2 border-dashed border-[var(--border)] rounded-card mb-6">
          <p className="text-sm text-secondary">{t('employee.pagamento.noEntriesThisPeriod')}</p>
        </div>
      )}
    </div>
  )
}
