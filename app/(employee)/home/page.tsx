import type { ReactNode } from 'react'
import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { LogoutForm } from '@/components/LogoutForm'
import { ClockButtons } from './ClockButtons'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { t } from '@/lib/i18n/translate'
import { hasPermission, type EmployeePermissions } from '@/lib/permissions'
import { DEFAULT_CLOCK_WINDOW, type ClockWindowSettings } from '@/lib/clock-window'
import { ThemeToggle } from '@/components/ThemeToggle'
import { calcEntryPay, isDailyPayMode } from '@/lib/payroll-calc'
import { getPayPeriodRange, isAwaitingPayment, loadCompanyPeriodSettings } from '@/lib/employee-period'

const supabaseReady =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')


export default async function EmployeeHomePage() {
  const user = getCurrentUser()
  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')

  const locale = user.language
  const today = new Date()
  const greeting = today.getHours() < 12
    ? t(locale, 'employee.home.goodMorning')
    : today.getHours() < 18
    ? t(locale, 'employee.home.goodAfternoon')
    : t(locale, 'employee.home.goodEvening')

  let profileId: string | null = null
  let openEntryId: string | null = null
  let clockInTime: string | null = null
  let isSupervisor = false
  let canSelfClock = true
  let clockWindow: ClockWindowSettings = DEFAULT_CLOCK_WINDOW
  let periodDays = 0
  let fullDaysCount = 0
  let halfDaysCount = 0
  let periodHours = 0
  let periodEarnings = 0
  let isDailyMode = false
  let dailyRate = 0
  let hourlyRate = 0
  let periodStartDate: Date | null = null
  let periodEndDate: Date | null = null
  let awaitingPayment = false

  if (supabaseReady) {
    try {
      const supabase = createClient()

      let { data: profile } = await supabase
        .from('profiles')
        .select('id, hourly_rate, daily_rate, permissions')
        .eq('email', user.email)
        .maybeSingle()

      if (!profile) {
        const { data: newProfile } = await supabase
          .from('profiles')
          .insert({
            company_id: user.company_id,
            role: user.role,
            full_name: user.full_name,
            email: user.email,
            status: 'active',
          })
          .select('id, hourly_rate, daily_rate, permissions')
          .single()
        profile = newProfile
      }

      if (profile) {
        profileId = profile.id
        isSupervisor = user.role === 'admin' || hasPermission(profile.permissions as EmployeePermissions | null, 'supervisor')
        const perms = profile.permissions as EmployeePermissions | null
        canSelfClock = user.role === 'admin' || perms?.self_clockin !== false

        const [{ data: openEntry }, { data: docSettings }] = await Promise.all([
          supabase
            .from('time_entries')
            .select('id, clock_in')
            .eq('employee_id', profile.id)
            .is('clock_out', null)
            .order('clock_in', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('company_document_settings')
            .select('timezone, enforce_clock_window, clock_in_window_start, clock_in_window_end, clock_out_deadline, home_period_type')
            .eq('company_id', user.company_id)
            .maybeSingle(),
        ])

        if (docSettings) {
          clockWindow = {
            timezone: docSettings.timezone ?? DEFAULT_CLOCK_WINDOW.timezone,
            enforce_clock_window: docSettings.enforce_clock_window ?? false,
            clock_in_window_start: docSettings.clock_in_window_start ?? DEFAULT_CLOCK_WINDOW.clock_in_window_start,
            clock_in_window_end: docSettings.clock_in_window_end ?? DEFAULT_CLOCK_WINDOW.clock_in_window_end,
            clock_out_deadline: docSettings.clock_out_deadline ?? DEFAULT_CLOCK_WINDOW.clock_out_deadline,
          }
        }

        if (openEntry) {
          openEntryId = openEntry.id
          clockInTime = openEntry.clock_in
        }

        // Same company pay period Admin Payroll uses (type + optional start date).
        const periodSettings = await loadCompanyPeriodSettings(supabase, user.company_id)
        // The period being paid: an ended, not-yet-finalized cycle comes
        // first, so Home shows what the employee is about to receive.
        const { start: periodStart, end: periodEnd } = getPayPeriodRange(periodSettings, today)
        periodStartDate = periodStart
        periodEndDate = periodEnd
        awaitingPayment = isAwaitingPayment({ end: periodEnd }, today)

        const periodStartISO = periodStart.toISOString().slice(0, 10)
        const periodEndISO = periodEnd.toISOString().slice(0, 10)

        const [{ data: periodEntries }, { data: manualComps }] = await Promise.all([
          supabase
            .from('time_entries')
            .select('clock_in, clock_out, is_full_day')
            .eq('employee_id', profile.id)
            .gte('clock_in', periodStart.toISOString())
            .lte('clock_in', periodEnd.toISOString())
            .not('clock_out', 'is', null),
          supabase
            .from('manual_compensations')
            .select('amount')
            .eq('person_type', 'employee')
            .eq('person_id', profile.id)
            .gte('compensation_date', periodStartISO)
            .lte('compensation_date', periodEndISO),
        ])

        const closed = periodEntries ?? []
        isDailyMode = isDailyPayMode({ daily_rate: profile.daily_rate, hourly_rate: profile.hourly_rate })
        dailyRate = Number(profile.daily_rate) || 0
        hourlyRate = Number(profile.hourly_rate) || 0

        // Same calcEntryPay() Days and Pay use, so Home can't show a
        // different "days worked" or earnings figure for the same period.
        for (const e of closed) {
          const calc = calcEntryPay({
            clock_in: e.clock_in,
            clock_out: e.clock_out,
            hours_worked: null, // not a column in production; derived from clock_in/clock_out
            is_full_day: e.is_full_day,
            daily_rate: profile.daily_rate,
            hourly_rate: profile.hourly_rate,
          })
          if (calc.fullDay) fullDaysCount += 1
          else if (isDailyMode) halfDaysCount += 1
          periodDays += calc.fullDay ? 1 : 0.5
          periodHours += calc.hoursWorked ?? 0
          periodEarnings += calc.totalPay
        }

        // Add manual compensations (production pay, bonuses, corrections)
        for (const mc of manualComps ?? []) {
          periodEarnings += Number(mc.amount)
        }
      }
    } catch {
      // silent fallback
    }
  }

  // Plain "Days Worked"/"Hours Worked"/"Est. Earnings" — the adjacent Pay
  // Period card already shows which period, so these don't need to repeat
  // "This Week"/"This Month" themselves.
  const daysLabel = t(locale, isDailyMode ? 'employee.home.daysWorkedLabel' : 'employee.home.hoursWorkedLabel')
  const earningsLabel = t(locale, 'employee.home.estEarnings')
  const periodStatValue = isDailyMode ? periodDays : periodHours

  const dateFmtLocale = locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US'
  const payPeriodLabel = periodStartDate && periodEndDate
    ? `${periodStartDate.toLocaleDateString(dateFmtLocale, { month: 'short', day: 'numeric' })} – ${periodEndDate.toLocaleDateString(dateFmtLocale, { month: 'short', day: 'numeric' })}`
    : null

  const daysBreakdown = isDailyMode && (fullDaysCount > 0 || halfDaysCount > 0)
    ? [
        fullDaysCount > 0 ? t(locale, fullDaysCount === 1 ? 'employee.home.fullDaySingular' : 'employee.home.fullDayPlural').replace('{n}', String(fullDaysCount)) : null,
        halfDaysCount > 0 ? t(locale, halfDaysCount === 1 ? 'employee.home.halfDaySingular' : 'employee.home.halfDayPlural').replace('{n}', String(halfDaysCount)) : null,
      ].filter(Boolean).join(' • ')
    : null

  const rateCaption = isDailyMode
    ? t(locale, 'employee.home.dailyRateCaption').replace('{rate}', dailyRate.toFixed(0)).replace('{half}', (dailyRate / 2).toFixed(0))
    : t(locale, 'employee.home.hourlyRateCaption').replace('{rate}', hourlyRate.toFixed(0))

  // Quick actions config — same card design as admin QuickActionsWidget
  type QA = { href: string; label: string; iconBg: string; iconColor: string; icon: ReactNode }
  const supervisorActions: QA[] = [
    {
      href: '/team/checkin',
      label: t(locale, 'employee.home.actionTeamClock'),
      iconBg: 'bg-blue/10',
      iconColor: 'text-blue',
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
        </svg>
      ),
    },
    {
      href: '/mileage',
      label: t(locale, 'employee.home.actionMileage'),
      iconBg: 'bg-blue/10',
      iconColor: 'text-blue',
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
          <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1v-1h3.05a2.5 2.5 0 014.9 0H19a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0017 6h-3V5a1 1 0 00-1-1H3zm11 4h2.586L18 9.414V10h-4V8z" />
        </svg>
      ),
    },
    {
      href: '/expenses',
      label: t(locale, 'employee.home.actionExpenses'),
      iconBg: 'bg-amber/10',
      iconColor: 'text-amber',
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      href: '/pagamento',
      label: t(locale, 'employee.home.actionPay'),
      iconBg: 'bg-green/10',
      iconColor: 'text-green',
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
        </svg>
      ),
    },
  ]

  const employeeActions: QA[] = [
    {
      href: '/pagamento',
      label: t(locale, 'employee.home.actionPay'),
      iconBg: 'bg-green/10',
      iconColor: 'text-green',
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      href: '/ponto',
      label: t(locale, 'employee.home.actionTime'),
      iconBg: 'bg-blue/10',
      iconColor: 'text-blue',
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
      ),
    },
  ]

  const quickActions = isSupervisor ? supervisorActions : employeeActions

  return (
    <div className="max-w-lg mx-auto px-4 py-6 md:py-8">

      {/* Greeting */}
      <div className="flex items-center gap-4 mb-8">
        <Link href="/profile" aria-label="Profile & Settings">
          <Avatar name={user.full_name} size="xl" />
        </Link>
        <div className="flex-1">
          <p className="text-sm text-secondary">{greeting},</p>
          <h1 className="text-2xl font-bold text-primary tracking-tight">{user.full_name}</h1>
          <p className="text-sm text-secondary">
            {today.toLocaleDateString(locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle layout="icon" />
          <LogoutForm>
            <button
              type="submit"
              className="p-2 rounded-button text-secondary hover:text-danger hover:bg-danger/10 transition-colors"
              aria-label="Sign Out"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
              </svg>
            </button>
          </LogoutForm>
        </div>
      </div>

      {/* Clock In/Out */}
      <Card className="mb-5">
        {profileId ? (
          <ClockButtons
            employeeId={profileId}
            companyId={user.company_id as string}
            openEntryId={openEntryId}
            clockInTime={clockInTime}
            isSupervisor={isSupervisor}
            clockWindow={clockWindow}
            canSelfClock={canSelfClock}
          />
        ) : (
          <div className="flex flex-col items-center gap-4 py-2">
            <p className="text-sm text-secondary">
              {supabaseReady ? t(locale, 'employee.home.settingUpProfile') : t(locale, 'employee.home.supabaseNotConnected')}
            </p>
            <button
              disabled
              className="inline-flex items-center justify-center gap-2 font-medium rounded-button bg-brand text-white h-12 px-6 text-base w-full disabled:opacity-40"
            >
              {t(locale, 'employee.home.clockIn')}
            </button>
          </div>
        )}
      </Card>

      {/* Period Stats */}
      <div className="grid grid-cols-3 gap-2.5 mb-5">
        <Card padding="sm">
          <p className="text-[10px] text-secondary uppercase tracking-wide mb-1">{t(locale, 'employee.home.payPeriod')}</p>
          <p className="text-base font-bold text-primary leading-snug">
            {payPeriodLabel ?? '—'}
          </p>
          <p className="text-[11px] text-secondary mt-0.5">{t(locale, awaitingPayment ? 'employee.home.awaitingPayment' : 'employee.home.currentPeriod')}</p>
        </Card>
        <Card padding="sm">
          <p className="text-[10px] text-secondary uppercase tracking-wide mb-1">{daysLabel}</p>
          <p className="text-xl font-bold text-primary tabular-nums">
            {supabaseReady && profileId
              ? (periodStatValue % 1 === 0 ? periodStatValue : periodStatValue.toFixed(1))
              : '—'}
          </p>
          {daysBreakdown && (
            <p className="text-[11px] text-secondary mt-0.5 leading-snug">{daysBreakdown}</p>
          )}
        </Card>
        <Card padding="sm">
          <p className="text-[10px] text-secondary uppercase tracking-wide mb-1">{earningsLabel}</p>
          <p className="text-xl font-bold text-primary tabular-nums">
            {supabaseReady && profileId && periodEarnings > 0
              ? `$${periodEarnings.toFixed(0)}`
              : '—'}
          </p>
          {periodEarnings > 0 && (
            <p className="text-[11px] text-secondary mt-0.5 leading-snug">{rateCaption}</p>
          )}
        </Card>
      </div>

      {/* Quick Actions */}
      <div>
        <p className="text-xs font-medium text-secondary uppercase tracking-wide mb-3">
          {t(locale, 'employee.home.quickActions')}
        </p>
        <div className={`grid gap-3 ${quickActions.length <= 2 ? 'grid-cols-2' : 'grid-cols-2'}`}>
          {quickActions.map(action => (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-col items-center gap-3 p-4 rounded-card bg-surface border border-[var(--border)] hover:border-brand/30 hover:bg-surface-elevated transition-colors"
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${action.iconBg}`}>
                <span className={action.iconColor}>{action.icon}</span>
              </div>
              <span className="text-sm font-medium text-primary text-center leading-tight">{action.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
