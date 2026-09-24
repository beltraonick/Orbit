import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { OrbitAIHub } from '@/components/OrbitAIHub'
import { QuickActionsWidget } from '@/components/admin/QuickActionsWidget'
import { getCurrentUser } from '@/lib/auth/session'
import { t } from '@/lib/i18n/translate'
import { getAttendanceStatus } from '@/app/actions/scheduleActions'

function StatCard({ label, value, sub, color = 'default' }: {
  label: string
  value: string | number
  sub?: string
  color?: 'default' | 'green' | 'amber' | 'red'
}) {
  const subColors = { default: 'text-secondary', green: 'text-green', amber: 'text-amber', red: 'text-danger' }
  return (
    <Card className="flex flex-col gap-1">
      <p className="text-xs font-medium text-secondary uppercase tracking-wide">{label}</p>
      <p className="text-2xl md:text-3xl font-bold text-primary tracking-tight">{value}</p>
      {sub && <p className={['text-xs font-medium', subColors[color]].join(' ')}>{sub}</p>}
    </Card>
  )
}


const supabaseReady =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

async function fetchStats(companyId: string) {
  if (!supabaseReady) return null
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = createClient()
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    weekStart.setHours(0, 0, 0, 0)
    const [
      { count: totalEmployees },
      { count: activeProjects },
      { data: todayClockedIn },
      { data: recentProjects },
      { data: recentTimeEntries },
      { data: pendingPayroll },
      { count: pendingRequestsCount },
    ] = await Promise.all([
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('role', 'employee').eq('status', 'active'),
      supabase.from('projects').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'active'),
      supabase.from('time_entries').select('id, employee_id, profiles:employee_id(full_name, avatar_url, position)').eq('company_id', companyId).is('clock_out', null),
      supabase.from('projects').select('id, name, client_name, progress, status').eq('company_id', companyId).eq('status', 'active').order('updated_at', { ascending: false }).limit(5),
      supabase.from('time_entries').select('id, clock_in, clock_out, profiles:employee_id(full_name, avatar_url)').eq('company_id', companyId).gte('clock_in', weekStart.toISOString()).order('clock_in', { ascending: false }).limit(6),
      supabase.from('payroll_records').select('total_amount').eq('company_id', companyId).eq('status', 'pending'),
      supabase.from('membership_requests').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'pending'),
    ])
    return { totalEmployees, activeProjects, todayClockedIn, recentProjects, recentTimeEntries, pendingPayroll, pendingRequestsCount }
  } catch {
    return null
  }
}

export default async function AdminDashboardPage() {
  const user = getCurrentUser()
  const locale = user?.language ?? 'en'
  const companyId = user?.company_id ?? ''
  const [stats, attendance] = companyId
    ? await Promise.all([fetchStats(companyId), getAttendanceStatus()])
    : [null, null]
  const today = new Date()
  const weeklyPayroll = stats?.pendingPayroll?.reduce((s, r) => s + Number(r.total_amount), 0) ?? 0

  const statusBadge = (s: string) => {
    const map: Record<string, { label: string; variant: 'green' | 'amber' | 'blue' | 'gray' }> = {
      active: { label: t(locale, 'admin.dashboard.statusActive'), variant: 'green' },
      on_hold: { label: t(locale, 'admin.dashboard.statusOnHold'), variant: 'amber' },
      completed: { label: t(locale, 'admin.dashboard.statusCompleted'), variant: 'blue' },
      cancelled: { label: t(locale, 'admin.dashboard.statusCancelled'), variant: 'gray' },
    }
    const badge = map[s] ?? { label: s, variant: 'gray' as const }
    return <Badge variant={badge.variant}>{badge.label}</Badge>
  }

  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      {/* Header */}
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{t(locale, 'admin.dashboard.title')}</h1>
        <p className="text-sm text-secondary mt-1">
          {today.toLocaleDateString(locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {!supabaseReady && (
        <div className="mb-5 md:mb-6 bg-amber/5 border border-amber/20 rounded-card px-4 py-3 md:px-5 md:py-4 flex items-start gap-3">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-amber flex-shrink-0 mt-0.5">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-amber">{t(locale, 'admin.dashboard.supabaseNotConnectedTitle')}</p>
            <p className="text-xs text-secondary mt-0.5">
              {t(locale, 'admin.dashboard.supabaseNotConnectedBody')}
            </p>
          </div>
        </div>
      )}

      {/* Pending Approval Requests Banner */}
      {stats && (stats.pendingRequestsCount ?? 0) > 0 && (
        <div className="mb-5 md:mb-6 bg-brand/5 border border-brand/20 rounded-card px-4 py-3 md:px-5 md:py-4 flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand/10 flex items-center justify-center mt-0.5">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-brand">
              <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-primary">
              {t(locale, 'admin.dashboard.pendingApprovals')}
              <span className="ml-2 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-brand text-white text-[11px] font-bold px-1.5">
                {stats.pendingRequestsCount}
              </span>
            </p>
            <p className="text-xs text-secondary mt-0.5">
              {t(locale, 'admin.dashboard.pendingApprovalsBody').replace('{n}', String(stats.pendingRequestsCount))}
            </p>
          </div>
          <a
            href="/admin/members"
            className="flex-shrink-0 text-xs font-semibold text-brand hover:text-brand-hover transition-colors whitespace-nowrap mt-0.5"
          >
            {t(locale, 'admin.dashboard.reviewRequests')}
          </a>
        </div>
      )}

      {/* Didn't clock in by the cutoff (9 AM) — people on a day off are left out */}
      {attendance && attendance.missing.length > 0 && (
        <div className="mb-5 md:mb-6 bg-brand/5 border border-brand/20 rounded-card px-4 py-3 md:px-5 md:py-4 flex items-start gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-full bg-brand/10 flex items-center justify-center mt-0.5">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-brand">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-primary">
              {t(locale, attendance.missing.length === 1 ? 'schedule.alert.notClockedInTitleOne' : 'schedule.alert.notClockedInTitle')
                .replace('{n}', String(attendance.missing.length))
                .replace('{time}', (() => {
                  const [h, m] = attendance.cutoff.split(':').map(Number)
                  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
                })())}
            </p>
            <p className="text-xs text-secondary mt-0.5 line-clamp-2">
              {attendance.missing.map(p => p.full_name).join(', ')}
            </p>
          </div>
          <a
            href="/admin/team-clock"
            className="flex-shrink-0 text-xs font-semibold text-brand hover:text-brand-hover transition-colors whitespace-nowrap mt-0.5"
          >
            {t(locale, 'schedule.alert.seeTeamClock')}
          </a>
        </div>
      )}

      {/* Day-off requests waiting for an answer */}
      {attendance && attendance.pendingRequests > 0 && (
        <div className="mb-5 md:mb-6 bg-amber/5 border border-amber/20 rounded-card px-4 py-3 md:px-5 md:py-4 flex items-center gap-3">
          <p className="flex-1 text-sm font-semibold text-primary">
            {t(locale, 'schedule.alert.requestsTitle').replace('{n}', String(attendance.pendingRequests))}
          </p>
          <a
            href="/admin/schedule"
            className="flex-shrink-0 text-xs font-semibold text-amber whitespace-nowrap"
          >
            {t(locale, 'schedule.alert.review')}
          </a>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
        <StatCard label={t(locale, 'admin.dashboard.clockedInToday')} value={stats?.todayClockedIn?.length ?? '—'} sub={stats ? t(locale, 'admin.dashboard.ofEmployees').replace('{n}', String(stats.totalEmployees ?? 0)) : t(locale, 'admin.dashboard.connectSupabase')} color="green" />
        <StatCard label={t(locale, 'admin.dashboard.activeProjects')} value={stats?.activeProjects ?? '—'} sub={stats ? t(locale, 'admin.dashboard.inProgress') : t(locale, 'admin.dashboard.connectSupabase')} />
        <StatCard label={t(locale, 'admin.dashboard.pendingPayroll')} value={stats ? `$${weeklyPayroll.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'} sub={stats ? t(locale, 'admin.dashboard.awaitingPayment') : t(locale, 'admin.dashboard.connectSupabase')} color="amber" />
        <StatCard label={t(locale, 'admin.dashboard.totalEmployees')} value={stats?.totalEmployees ?? '—'} sub={stats ? t(locale, 'admin.dashboard.activeWorkers') : t(locale, 'admin.dashboard.connectSupabase')} />
      </div>

      {/* Quick Actions — customizable client widget */}
      <QuickActionsWidget />

      {/* Orbit AI Hub */}
      <OrbitAIHub />

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 md:gap-6">
        <div className="lg:col-span-3">
          <Card padding="none">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h2 className="text-sm font-semibold text-primary">{t(locale, 'admin.dashboard.activeProjects')}</h2>
              <a href="/admin/projects" className="text-xs text-brand hover:text-brand-hover font-medium transition-colors">{t(locale, 'admin.dashboard.viewAll')}</a>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {!stats && <p className="px-5 py-8 text-sm text-secondary text-center">{t(locale, 'admin.dashboard.connectSupabaseProjects')}</p>}
              {stats?.recentProjects?.length === 0 && <p className="px-5 py-8 text-sm text-secondary text-center">{t(locale, 'admin.dashboard.noActiveProjects')}</p>}
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(stats?.recentProjects as any[])?.map(p => (
                <a key={p.id} href={`/admin/projects/${p.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-surface-elevated transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-primary truncate">{p.name}</p>
                    <p className="text-xs text-secondary mt-0.5 truncate">{p.client_name ?? t(locale, 'admin.dashboard.noClient')}</p>
                  </div>
                  <div className="w-32 flex flex-col gap-1.5">
                    <div className="flex justify-between">
                      <span className="text-xs text-secondary">{t(locale, 'admin.dashboard.progress')}</span>
                      <span className="text-xs font-medium text-primary">{p.progress}%</span>
                    </div>
                    <ProgressBar value={p.progress} />
                  </div>
                  {statusBadge(p.status)}
                </a>
              ))}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-2 flex flex-col gap-4 md:gap-6">
          <Card padding="none">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h2 className="text-sm font-semibold text-primary">{t(locale, 'admin.dashboard.clockedInNow')}</h2>
              <span className="flex items-center gap-1.5 text-xs text-green font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" /> {t(locale, 'admin.dashboard.live')}
              </span>
            </div>
            {!stats && <p className="px-5 py-6 text-sm text-secondary text-center">{t(locale, 'admin.dashboard.connectSupabase')}</p>}
            {stats?.todayClockedIn?.length === 0 && <p className="px-5 py-6 text-sm text-secondary text-center">{t(locale, 'admin.dashboard.noOneClockedIn')}</p>}
            <div className="divide-y divide-[var(--border)]">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(stats?.todayClockedIn as any[])?.slice(0, 5).map((e: any) => (
                <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={e.profiles?.full_name ?? '?'} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-primary truncate">{e.profiles?.full_name}</p>
                    <p className="text-xs text-secondary truncate">{e.profiles?.position ?? t(locale, 'admin.dashboard.worker')}</p>
                  </div>
                  <Badge variant="green">{t(locale, 'admin.dashboard.in')}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h2 className="text-sm font-semibold text-primary">{t(locale, 'admin.dashboard.recentHours')}</h2>
              <a href="/admin/time" className="text-xs text-brand hover:text-brand-hover font-medium transition-colors">{t(locale, 'admin.dashboard.viewAll')}</a>
            </div>
            {!stats && <p className="px-5 py-6 text-sm text-secondary text-center">{t(locale, 'admin.dashboard.connectSupabase')}</p>}
            {stats?.recentTimeEntries?.length === 0 && <p className="px-5 py-6 text-sm text-secondary text-center">{t(locale, 'admin.dashboard.noEntriesThisWeek')}</p>}
            <div className="divide-y divide-[var(--border)]">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {(stats?.recentTimeEntries as any[])?.map((e: any) => (
                <div key={e.id} className="flex items-center gap-3 px-5 py-3">
                  <Avatar name={e.profiles?.full_name ?? '?'} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-primary truncate">{e.profiles?.full_name}</p>
                    <p className="text-xs text-secondary">
                      {new Date(e.clock_in).toLocaleDateString(locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <span className="text-sm font-semibold text-primary">
                    {e.clock_out ? `${((new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 3600000).toFixed(1)}h` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
