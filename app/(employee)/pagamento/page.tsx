import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { createClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/translate'
import { PagamentoPeriodFilter } from '@/components/employee/PagamentoPeriodFilter'

const supabaseReady =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default async function PagamentoPage() {
  const user = getCurrentUser()
  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')

  const locale = user.language

  let profileId = ''
  let hourlyRate = 0
  let dailyRate: number | null = null
  let paidPeriods: { periodStart: string; periodEnd: string; totalPay: number }[] = []

  if (supabaseReady) {
    try {
      const supabase = createClient()
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, hourly_rate, daily_rate')
        .eq('email', user.email)
        .maybeSingle()

      if (profile) {
        profileId = profile.id
        hourlyRate = Number(profile.hourly_rate) || 0
        dailyRate = profile.daily_rate != null ? Number(profile.daily_rate) : null

        // Only a finalized payroll period is an authoritative "Paid" record —
        // payroll_periods only ever gets a row when an admin actually
        // finalizes payroll (Payroll tab -> Finalize Payroll), so every row
        // here really was paid, never a guess or a live estimate.
        const { data: entries } = await supabase
          .from('payroll_period_entries')
          .select('total_pay, overtime_pay, payroll_periods:payroll_period_id(period_start, period_end)')
          .eq('company_id', user.company_id)
          .eq('person_id', profile.id)
          .order('entry_date', { ascending: false })
          .limit(500)

        type Row = { total_pay: number; overtime_pay: number; payroll_periods: { period_start: string; period_end: string } | null }
        const byPeriod = new Map<string, { periodStart: string; periodEnd: string; totalPay: number }>()
        for (const e of (entries ?? []) as unknown as Row[]) {
          const period = e.payroll_periods
          if (!period) continue
          const key = `${period.period_start}_${period.period_end}`
          const existing = byPeriod.get(key)
          const amount = Number(e.total_pay) + Number(e.overtime_pay)
          if (existing) existing.totalPay += amount
          else byPeriod.set(key, { periodStart: period.period_start, periodEnd: period.period_end, totalPay: amount })
        }
        paidPeriods = Array.from(byPeriod.values())
          .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
          .slice(0, 12)
      }
    } catch {
      // silent fallback
    }
  }

  const isDailyRate = dailyRate != null && dailyRate > 0
  const rateDisplay = isDailyRate
    ? t(locale, 'employee.pagamento.ratePerDay').replace('{rate}', fmt(dailyRate!))
    : hourlyRate > 0
      ? t(locale, 'employee.pagamento.ratePerHour').replace('{rate}', fmt(hourlyRate))
      : t(locale, 'employee.pagamento.rateNotConfigured')

  return (
    <div className="max-w-lg mx-auto px-4 pt-6 pb-4">
      <h1 className="text-xl font-bold text-primary mb-1">{t(locale, 'employee.pagamento.title')}</h1>
      <p className="text-sm text-secondary mb-6">
        {t(locale, 'employee.pagamento.rateLabel')} {rateDisplay}
      </p>

      {profileId ? (
        <PagamentoPeriodFilter
          profileId={profileId}
          hourlyRate={hourlyRate}
          dailyRate={dailyRate}
        />
      ) : (
        <div className="text-center py-10 border-2 border-dashed border-[var(--border)] rounded-card mb-6">
          <p className="text-sm text-secondary">{t(locale, 'employee.pagamento.rateNotConfigured')}</p>
        </div>
      )}

      {/* Payroll history — only shows periods an admin has actually
          finalized (Payroll tab -> Finalize Payroll), so every row here is a
          real, confirmed payment record, never an estimate. */}
      <Card padding="none">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-primary">{t(locale, 'employee.pagamento.payrollHistory')}</h2>
        </div>
        {paidPeriods.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-secondary">{t(locale, 'employee.pagamento.noPayrollRecords')}</p>
            <p className="text-xs text-tertiary mt-1">{t(locale, 'employee.pagamento.recordsAppearAfter')}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {paidPeriods.map(p => (
              <div key={`${p.periodStart}_${p.periodEnd}`} className="px-5 py-4 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-primary">
                  {new Date(p.periodStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' – '}
                  {new Date(p.periodEnd + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
                <div className="text-right flex flex-col items-end gap-1.5">
                  <span className="text-base font-bold text-primary">{fmt(p.totalPay)}</span>
                  <Badge variant="green">{t(locale, 'employee.pagamento.paid')}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
