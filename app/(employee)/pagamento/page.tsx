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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let payrollRecords: any[] = []

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

        const { data: records } = await supabase
          .from('payroll_records')
          .select('*')
          .eq('employee_id', profile.id)
          .order('period_start', { ascending: false })
          .limit(12)

        payrollRecords = records ?? []
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

      {/* Payroll history */}
      <Card padding="none">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-primary">{t(locale, 'employee.pagamento.payrollHistory')}</h2>
        </div>
        {payrollRecords.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm text-secondary">{t(locale, 'employee.pagamento.noPayrollRecords')}</p>
            <p className="text-xs text-tertiary mt-1">{t(locale, 'employee.pagamento.recordsAppearAfter')}</p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {payrollRecords.map((r: any) => (
              <div key={r.id} className="px-5 py-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-primary">
                    {new Date(r.period_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' – '}
                    {new Date(r.period_end + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                  <p className="text-xs text-secondary mt-0.5">
                    {Number(r.total_hours).toFixed(1)}h
                    {r.hourly_rate > 0 ? ` · ${fmt(Number(r.hourly_rate))}/hr` : ''}
                  </p>
                </div>
                <div className="text-right flex flex-col items-end gap-1.5">
                  <span className="text-base font-bold text-primary">{fmt(Number(r.total_amount))}</span>
                  {r.status === 'paid'
                    ? <Badge variant="green">{t(locale, 'employee.pagamento.paid')}</Badge>
                    : <Badge variant="amber">{t(locale, 'common.pending')}</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
