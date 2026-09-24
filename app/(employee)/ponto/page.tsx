import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { DayTypeBadge } from '@/components/ui/DayTypeBadge'
import { createClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/translate'
import { calcEntryPay, isDailyPayMode } from '@/lib/payroll-calc'
import { getPayPeriodRange, loadCompanyPeriodSettings } from '@/lib/employee-period'

const supabaseReady =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

function calcHours(clockIn: string, clockOut: string | null) {
  if (!clockOut) return null
  return (new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 3600000
}

export default async function PontoPage() {
  const user = getCurrentUser()
  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')

  const locale = user.language

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let entries: any[] = []
  let periodDays = 0
  let periodHours = 0
  let isDailyMode = false
  let profileDailyRate: number | null = null
  let profileHourlyRate: number | null = null
  let periodStartDate: Date | null = null
  let periodEndDate: Date | null = null

  if (supabaseReady) {
    try {
      const supabase = createClient()
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, daily_rate, hourly_rate')
        .eq('email', user.email)
        .maybeSingle()

      if (profile) {
        isDailyMode = isDailyPayMode({ daily_rate: profile.daily_rate, hourly_rate: profile.hourly_rate })
        profileDailyRate = profile.daily_rate
        profileHourlyRate = profile.hourly_rate

        const { data } = await supabase
          .from('time_entries')
          .select('id, clock_in, clock_out, is_full_day, city, state, approval_status, project:project_id(name)')
          .eq('employee_id', profile.id)
          .order('clock_in', { ascending: false })
          .limit(90)

        entries = data ?? []

        // Same calcEntryPay() Home and Pay use, over the same period Home
        // shows — so Days can't disagree with either.
        const periodSettings = await loadCompanyPeriodSettings(supabase, user.company_id)
        const { start: periodStart, end: periodEnd } = getPayPeriodRange(periodSettings)
        periodStartDate = periodStart
        periodEndDate = periodEnd
        for (const e of entries) {
          if (!e.clock_out || new Date(e.clock_in) < periodStart || new Date(e.clock_in) > periodEnd) continue
          const calc = calcEntryPay({
            clock_in: e.clock_in,
            clock_out: e.clock_out,
            hours_worked: e.hours_worked != null ? Number(e.hours_worked) : null,
            is_full_day: e.is_full_day,
            daily_rate: profile.daily_rate,
            hourly_rate: profile.hourly_rate,
          })
          periodDays += calc.fullDay ? 1 : 0.5
          periodHours += calc.hoursWorked ?? 0
        }
      }
    } catch {
      // silent fallback
    }
  }

  const periodStatValue = isDailyMode ? periodDays : periodHours
  const dateFmtLocale = locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US'
  const payPeriodLabel = periodStartDate && periodEndDate
    ? `${periodStartDate.toLocaleDateString(dateFmtLocale, { month: 'short', day: 'numeric' })} – ${periodEndDate.toLocaleDateString(dateFmtLocale, { month: 'short', day: 'numeric' })}`
    : null

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <h1 className="text-xl font-bold text-primary mb-1">{t(locale, 'employee.ponto.title')}</h1>
      <p className="text-sm text-secondary mb-6">{t(locale, 'employee.ponto.subtitle')}</p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card>
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t(locale, 'employee.home.payPeriod')}</p>
          <p className="text-xl font-bold text-primary leading-snug">{payPeriodLabel ?? '—'}</p>
        </Card>
        <Card>
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">
            {isDailyMode ? t(locale, 'employee.home.daysWorkedLabel') : t(locale, 'employee.home.hoursWorkedLabel')}
          </p>
          <p className="text-2xl font-bold text-primary">
            {periodStatValue > 0
              ? (isDailyMode
                  ? (periodStatValue % 1 === 0 ? periodStatValue : periodStatValue.toFixed(1))
                  : `${periodStatValue.toFixed(1)}h`)
              : '—'}
          </p>
        </Card>
      </div>

      <Card padding="none">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-primary">{t(locale, 'employee.ponto.recentEntries')}</h2>
        </div>

        {entries.length === 0 ? (
          <p className="px-5 py-10 text-sm text-secondary text-center">
            {supabaseReady ? t(locale, 'employee.ponto.noEntriesYet') : t(locale, 'employee.ponto.connectSupabase')}
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {entries.map((e: any) => {
              const hours = calcHours(e.clock_in, e.clock_out)
              const fullDay = isDailyMode && e.clock_out
                ? calcEntryPay({
                    clock_in: e.clock_in,
                    clock_out: e.clock_out,
                    hours_worked: e.hours_worked != null ? Number(e.hours_worked) : null,
                    is_full_day: e.is_full_day,
                    daily_rate: profileDailyRate,
                    hourly_rate: profileHourlyRate,
                  }).fullDay
                : null
              const status = e.approval_status ?? 'approved'
              const inTime = new Date(e.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
              const outTime = e.clock_out
                ? new Date(e.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                : null
              return (
                <div key={e.id} className="px-5 py-4 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-primary">
                      {new Date(e.clock_in).toLocaleDateString('en-US', {
                        weekday: 'short', month: 'short', day: 'numeric',
                      })}
                    </p>
                    <p className="text-xs text-secondary mt-0.5">
                      {inTime}{outTime ? ` → ${outTime}` : ` — ${t(locale, 'employee.ponto.inProgress')}`}
                    </p>
                    {(e.city || e.project?.name) && (
                      <p className="text-xs text-tertiary mt-0.5 truncate">
                        {e.project?.name ?? ''}
                        {e.city ? ` · ${e.city}${e.state ? `, ${e.state}` : ''}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {fullDay != null ? (
                      <DayTypeBadge
                        fullDay={fullDay}
                        label={fullDay ? t(locale, 'employee.pagamento.fullDay') : t(locale, 'employee.pagamento.halfDay')}
                      />
                    ) : hours != null && (
                      <span className="text-sm font-semibold text-primary tabular-nums">
                        {hours.toFixed(2)}h
                      </span>
                    )}
                    {!e.clock_out && <Badge variant="green">{t(locale, 'common.active')}</Badge>}
                    {e.clock_out && status === 'pending' && <Badge variant="amber">{t(locale, 'common.pending')}</Badge>}
                    {status === 'rejected' && <Badge variant="gray">{t(locale, 'common.rejected')}</Badge>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
