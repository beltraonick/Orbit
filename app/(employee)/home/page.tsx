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

const supabaseReady =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

type PeriodType = 'weekly' | 'biweekly' | 'monthly'

function getPeriodRange(periodType: PeriodType, today: Date): { start: Date } {
  const start = new Date(today)
  if (periodType === 'weekly') {
    start.setDate(today.getDate() - today.getDay())
    start.setHours(0, 0, 0, 0)
  } else if (periodType === 'biweekly') {
    const day = today.getDate()
    start.setDate(day <= 15 ? 1 : 16)
    start.setHours(0, 0, 0, 0)
  } else {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  }
  return { start }
}

function periodDaysLabel(periodType: PeriodType, locale: string) {
  if (periodType === 'weekly') return t(locale, 'employee.home.daysThisWeek')
  if (periodType === 'monthly') return t(locale, 'employee.home.daysThisMonth')
  return t(locale, 'employee.home.daysThisPeriod')
}

function periodEarningsLabel(periodType: PeriodType, locale: string) {
  if (periodType === 'weekly') return t(locale, 'employee.home.earningsThisWeek')
  if (periodType === 'monthly') return t(locale, 'employee.home.earningsThisMonth')
  return t(locale, 'employee.home.earningsThisPeriod')
}

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
  let periodEarnings = 0
  let homePeriodType: PeriodType = 'biweekly'

  if (supabaseReady) {
    try {
      const supabase = createClient()

      let { data: profile } = await supabase
        .from('profiles')
        .select('id, hourly_rate, permissions')
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
          .select('id, hourly_rate, permissions')
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
          if (docSettings.home_period_type) {
            homePeriodType = docSettings.home_period_type as PeriodType
          }
        }

        if (openEntry) {
          openEntryId = openEntry.id
          clockInTime = openEntry.clock_in
        }

        const { start: periodStart } = getPeriodRange(homePeriodType, today)

        const { data: periodEntries } = await supabase
          .from('time_entries')
          .select('clock_in, clock_out')
          .eq('employee_id', profile.id)
          .gte('clock_in', periodStart.toISOString())
          .not('clock_out', 'is', null)

        const closed = periodEntries ?? []
        // Count distinct calendar days with at least one closed entry
        periodDays = new Set(closed.map(e => e.clock_in.slice(0, 10))).size
        const hourlyRate = Number(profile.hourly_rate) || 0
        periodEarnings = closed.reduce((sum, e) => {
          const h = (new Date(e.clock_out!).getTime() - new Date(e.clock_in).getTime()) / 3600000
          return sum + h * hourlyRate
        }, 0)
      }
    } catch {
      // silent fallback
    }
  }

  const daysLabel = periodDaysLabel(homePeriodType, locale)
  const earningsLabel = periodEarningsLabel(homePeriodType, locale)

  // Quick actions config
  type QA = { href: string; label: string; icon: ReactNode }
  const supervisorActions: QA[] = [
    {
      href: '/team/checkin',
      label: t(locale, 'employee.home.actionTeamClock'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      ),
    },
    {
      href: '/mileage',
      label: t(locale, 'employee.home.actionMileage'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
        </svg>
      ),
    },
    {
      href: '/expenses',
      label: t(locale, 'employee.home.actionExpenses'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" />
        </svg>
      ),
    },
    {
      href: '/pagamento',
      label: t(locale, 'employee.home.actionPay'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
    },
  ]

  const employeeActions: QA[] = [
    {
      href: '/pagamento',
      label: t(locale, 'employee.home.actionPay'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
    },
    {
      href: '/ponto',
      label: t(locale, 'employee.home.actionTime'),
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
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
      <div className="grid grid-cols-2 gap-3 mb-5">
        <Card>
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">{daysLabel}</p>
          <p className="text-2xl font-bold text-primary tabular-nums">
            {supabaseReady && profileId ? periodDays : '—'}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">{earningsLabel}</p>
          <p className="text-2xl font-bold text-primary tabular-nums">
            {supabaseReady && profileId && periodEarnings > 0
              ? `$${periodEarnings.toFixed(0)}`
              : '—'}
          </p>
          {periodEarnings > 0 && (
            <p className="text-xs text-secondary mt-0.5">{t(locale, 'employee.home.projected')}</p>
          )}
        </Card>
      </div>

      {/* Quick Actions */}
      <Card padding="none">
        <div className="px-5 py-3.5 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-primary">{t(locale, 'employee.home.quickActions')}</h2>
        </div>
        <div className={`grid gap-px bg-[var(--border)] ${quickActions.length === 4 ? 'grid-cols-2' : 'grid-cols-2'}`}>
          {quickActions.map(action => (
            <Link
              key={action.href}
              href={action.href}
              className="flex flex-col items-center justify-center gap-2 px-4 py-5 bg-[var(--surface)] hover:bg-surface-elevated transition-colors"
            >
              <span className="text-brand">{action.icon}</span>
              <span className="text-xs font-medium text-primary text-center">{action.label}</span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  )
}
