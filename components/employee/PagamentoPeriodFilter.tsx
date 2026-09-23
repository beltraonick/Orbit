'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { calcEntryPay } from '@/lib/payroll-calc'
import { getFinalizedPayrollPeriod } from '@/app/actions/payrollActions'

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const fmtDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })

function getQuinzenaDates(which: 'current' | 'last'): { start: string; end: string } {
  const now = new Date()
  const day = now.getDate()
  const year = now.getFullYear()
  const month = now.getMonth()
  let start: Date, end: Date
  if (which === 'current') {
    if (day <= 15) {
      start = new Date(year, month, 1)
      end = new Date(year, month, 15)
    } else {
      start = new Date(year, month, 16)
      end = new Date(year, month + 1, 0)
    }
  } else {
    if (day <= 15) {
      start = new Date(year, month - 1, 16)
      end = new Date(year, month, 0)
    } else {
      start = new Date(year, month, 1)
      end = new Date(year, month, 15)
    }
  }
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

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

  const [preset, setPreset] = useState<'current' | 'last' | 'custom'>('current')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [entries, setEntries] = useState<DisplayEntry[]>([])
  const [loading, setLoading] = useState(true)
  // A finalized period's numbers are frozen (Payroll tab -> Finalize
  // Payroll) — they can never disagree with what was actually paid, so this
  // screen shows them as-is instead of recomputing from live rates.
  const [finalized, setFinalized] = useState(false)

  const periodStart = preset === 'custom' ? customStart : getQuinzenaDates(preset as 'current' | 'last').start
  const periodEnd = preset === 'custom' ? customEnd : getQuinzenaDates(preset as 'current' | 'last').end

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
      .select('id, clock_in, clock_out, hours_worked, is_full_day, notes, project:project_id(name)')
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
  const totalDays = isDailyRate ? entries.reduce((s, e) => s + (e.fullDay ? 1 : 0.5), 0) : 0

  const PRESET_OPTIONS = [
    { value: 'current', label: t('employee.pagamento.currentPeriod') },
    { value: 'last',    label: t('employee.pagamento.lastPeriod') },
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

      {!loading && entries.length > 0 && (
        <div className="mb-3">
          {finalized
            ? <Badge variant="green">{t('employee.pagamento.paid')}</Badge>
            : <Badge variant="amber">{t('employee.pagamento.estimated')}</Badge>}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card>
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">
            {t('employee.pagamento.periodEarnings')}
          </p>
          <p className="text-2xl font-bold text-primary">
            {loading ? '—' : totalEarnings > 0 ? fmt(totalEarnings) : '—'}
          </p>
          <p className="text-xs text-secondary mt-1">
            {!loading && (isDailyRate
              ? t('employee.pagamento.daysWorked').replace('{n}', totalDays % 1 === 0 ? String(totalDays) : totalDays.toFixed(1))
              : t('employee.pagamento.hoursWorked').replace('{n}', totalHours.toFixed(1)))}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">
            {t('employee.pagamento.entriesCount')}
          </p>
          <p className="text-2xl font-bold text-primary">
            {loading ? '—' : entries.length}
          </p>
          <p className="text-xs text-secondary mt-1">
            {!loading && (isDailyRate
              ? t('employee.pagamento.daysWorked').replace('{n}', '')
              : t('employee.pagamento.hoursWorked').replace('{n}', ''))
              .replace('{n}', '').trim()}
          </p>
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
                <div key={e.id} className="flex items-start gap-3 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-primary">{fmtDate(e.date)}</p>
                    <p className="text-xs text-secondary mt-0.5 truncate">
                      {e.projectName ?? '—'}
                      {dayLabel ? ` · ${dayLabel}` : ` · ${(e.hours ?? 0).toFixed(1)}h`}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-primary tabular-nums flex-shrink-0">
                    {fmt(e.amount)}
                  </span>
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
