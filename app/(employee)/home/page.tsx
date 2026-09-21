import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { LogoutForm } from '@/components/LogoutForm'
import { ClockButtons } from './ClockButtons'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { t } from '@/lib/i18n/translate'
import { hasPermission, type EmployeePermissions } from '@/lib/permissions'
import { DEFAULT_CLOCK_WINDOW, type ClockWindowSettings } from '@/lib/clock-window'

const supabaseReady =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

export default async function EmployeeHomePage() {
  const user = getCurrentUser()
  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')

  const locale = user.language
  const today = new Date()
  const greeting = today.getHours() < 12 ? t(locale, 'employee.home.goodMorning') : today.getHours() < 18 ? t(locale, 'employee.home.goodAfternoon') : t(locale, 'employee.home.goodEvening')

  let profileId: string | null = null
  let openEntryId: string | null = null
  let clockInTime: string | null = null
  let isSupervisor = false
  let clockWindow: ClockWindowSettings = DEFAULT_CLOCK_WINDOW
  let weekHours = 0
  let weekEarnings = 0
  let tasks: {
    id: string
    title: string
    priority: string
    project: { name: string } | null
    area: string | null
  }[] = []

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

        const weekStart = new Date(today)
        weekStart.setDate(today.getDate() - today.getDay())
        weekStart.setHours(0, 0, 0, 0)

        const [{ data: openEntry }, { data: weekEntries }, { data: myTasks }, { data: docSettings }] = await Promise.all([
          supabase
            .from('time_entries')
            .select('id, clock_in')
            .eq('employee_id', profile.id)
            .is('clock_out', null)
            .order('clock_in', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('time_entries')
            .select('clock_in, clock_out')
            .eq('employee_id', profile.id)
            .gte('clock_in', weekStart.toISOString())
            .not('clock_out', 'is', null),
          supabase
            .from('tasks')
            .select('id, title, priority, area, project:project_id(name)')
            .eq('assigned_to', profile.id)
            .neq('status', 'completed')
            .order('created_at', { ascending: false })
            .limit(3),
          supabase
            .from('company_document_settings')
            .select('timezone, enforce_clock_window, clock_in_window_start, clock_in_window_end, clock_out_deadline')
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

        weekHours = (weekEntries ?? []).reduce((sum, e) => {
          return sum + (new Date(e.clock_out!).getTime() - new Date(e.clock_in).getTime()) / 3600000
        }, 0)

        const hourlyRate = Number(profile.hourly_rate) || 0
        const regularHours = Math.min(weekHours, 40)
        const overtimeHours = Math.max(weekHours - 40, 0)
        weekEarnings = regularHours * hourlyRate + overtimeHours * hourlyRate * 1.5

        tasks = (myTasks ?? []) as unknown as typeof tasks
      }
    } catch {
      // silent fallback
    }
  }

  const PRIORITY_DOT: Record<string, string> = {
    urgent: 'bg-danger',
    high: 'bg-danger/60',
    medium: 'bg-amber',
    low: 'bg-blue',
  }

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

      {/* Week Summary */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <Card>
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t(locale, 'employee.home.hoursThisWeek')}</p>
          <p className="text-2xl font-bold text-primary">
            {supabaseReady && profileId ? `${weekHours.toFixed(1)}h` : '—'}
          </p>
          {weekHours > 40 && (
            <p className="text-xs text-amber mt-0.5">{(weekHours - 40).toFixed(1)}h {t(locale, 'employee.home.overtimeSuffix')}</p>
          )}
        </Card>
        <Card>
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t(locale, 'employee.home.earningsThisWeek')}</p>
          <p className="text-2xl font-bold text-primary">
            {supabaseReady && profileId && weekEarnings > 0
              ? `$${weekEarnings.toFixed(0)}`
              : '—'}
          </p>
          {weekEarnings > 0 && (
            <p className="text-xs text-secondary mt-0.5">{t(locale, 'employee.home.projected')}</p>
          )}
        </Card>
      </div>

      {/* My Tasks preview */}
      <Card padding="none">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-primary">{t(locale, 'employee.home.myTasks')}</h2>
          <Link href="/tasks" className="text-xs text-brand hover:text-brand-hover font-medium transition-colors">
            {t(locale, 'employee.home.viewAll')}
          </Link>
        </div>

        {!supabaseReady && (
          <p className="px-5 py-6 text-sm text-secondary text-center">{t(locale, 'employee.home.connectSupabase')}</p>
        )}

        {supabaseReady && tasks.length === 0 && (
          <div className="px-5 py-8 text-center">
            <div className="w-10 h-10 rounded-full bg-green/10 flex items-center justify-center mx-auto mb-2">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-green">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-sm text-secondary">{t(locale, 'employee.home.noOpenTasks')}</p>
          </div>
        )}

        {tasks.length > 0 && (
          <div className="divide-y divide-[var(--border)]">
            {tasks.map(t => (
              <Link key={t.id} href="/tasks" className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-elevated transition-colors">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] ?? 'bg-secondary'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-primary truncate">{t.title}</p>
                  {t.project?.name && (
                    <p className="text-xs text-secondary truncate">{t.project.name}{t.area ? ` · ${t.area}` : ''}</p>
                  )}
                </div>
                <Badge variant={t.priority === 'urgent' ? 'red' : t.priority === 'high' ? 'red' : t.priority === 'medium' ? 'amber' : 'gray'}>
                  {t.priority}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
