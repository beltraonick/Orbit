import Link from 'next/link'
// Legitimately cross-company: the platform owner sees every company, so
// this can't be scoped by the single-company_id JWT claim the regular
// bridged client sends (that claim is null for an owner, so the
// company-scoped RLS policy silently returns zero rows for every table).
import { createServiceRoleClient as createClient } from '@/lib/supabase/service-role'
import { getCurrentUser } from '@/lib/auth/session'
import { t } from '@/lib/i18n/translate'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { subscriptionStatusKey, subscriptionStatusVariant, isCompanyOverdue } from '@/lib/owner-status'

const supabaseReady =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

const DATE_LOCALE: Record<string, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' }

interface CompanyRow {
  id: string
  name: string
  subscription_status: string
  months_overdue: number | null
  trial_ends_at: string | null
  created_at: string
  unlimited_override: boolean | null
  plan: { name: string; price_cents: number; project_limit: number | null } | null
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-tertiary flex-shrink-0">
      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
    </svg>
  )
}

interface ActivityRow {
  full_name: string
  role: string
  last_login_at: string
  company: { name: string } | null
}

function statusBadge(s: string, locale: 'en' | 'pt' | 'es') {
  return <Badge variant={subscriptionStatusVariant(s)}>{t(locale, subscriptionStatusKey(s))}</Badge>
}

export default async function OwnerDashboardPage() {
  const user = getCurrentUser()
  const locale = user?.language ?? 'en'
  let companies: CompanyRow[] = []
  let counts = new Map<string, { admins: number; employees: number; clients: number; projects: number }>()
  let mrrCents = 0
  let totalUsers = 0
  let totalProjects = 0
  let recentActivity: ActivityRow[] = []
  // Distinguishes "genuinely zero companies" from "the query itself failed"
  // (e.g. a misconfigured service-role key) — both used to render as the
  // same silent "No companies yet" empty state, which is exactly what made
  // an actual configuration problem look like empty data.
  let loadError = false

  if (supabaseReady) {
    try {
      const supabase = createClient()
      const [{ data: companyRows }, { data: profileRows }, { data: projectRows }, { data: activityRows }] = await Promise.all([
        supabase
          .from('companies')
          .select('id, name, subscription_status, months_overdue, trial_ends_at, created_at, unlimited_override, plan:plan_id(name, price_cents, project_limit)')
          .order('created_at', { ascending: false }),
        supabase.from('profiles').select('company_id, role'),
        supabase.from('projects').select('company_id'),
        supabase
          .from('profiles')
          .select('full_name, role, last_login_at, company:company_id(name)')
          .neq('role', 'owner')
          .not('last_login_at', 'is', null)
          .order('last_login_at', { ascending: false })
          .limit(8),
      ])

      companies = (companyRows ?? []) as unknown as CompanyRow[]
      recentActivity = (activityRows ?? []) as unknown as ActivityRow[]

      counts = new Map()
      for (const c of companies) counts.set(c.id, { admins: 0, employees: 0, clients: 0, projects: 0 })
      for (const p of profileRows ?? []) {
        const bucket = p.company_id ? counts.get(p.company_id) : null
        if (!bucket) continue
        if (p.role === 'admin') bucket.admins++
        else if (p.role === 'employee') bucket.employees++
        else if (p.role === 'client') bucket.clients++
      }
      for (const pr of projectRows ?? []) {
        const bucket = pr.company_id ? counts.get(pr.company_id) : null
        if (bucket) bucket.projects++
      }

      mrrCents = companies
        .filter(c => c.subscription_status === 'active')
        .reduce((sum, c) => sum + (c.plan?.price_cents ?? 0), 0)
      totalUsers = (profileRows ?? []).length
      totalProjects = (projectRows ?? []).length
    } catch (err) {
      loadError = true
      console.error('[owner-dashboard] failed to load companies:', err)
    }
  }

  const activeCount = companies.filter(c => c.subscription_status === 'active').length
  const trialingCount = companies.filter(c => c.subscription_status === 'trialing').length
  const overdueCount = companies.filter(c => isCompanyOverdue(c.subscription_status, c.months_overdue)).length

  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{t(locale, 'owner.dashboard.title')}</h1>
        <p className="text-sm text-secondary mt-1">{t(locale, 'owner.dashboard.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-3 md:mb-4">
        <Card><p className="text-xs text-secondary uppercase tracking-wide mb-1">{t(locale, 'owner.dashboard.companies')}</p><p className="text-2xl font-bold text-primary">{companies.length}</p></Card>
        <Card><p className="text-xs text-secondary uppercase tracking-wide mb-1">{t(locale, 'owner.dashboard.active')}</p><p className="text-2xl font-bold text-green">{activeCount}</p></Card>
        <Card><p className="text-xs text-secondary uppercase tracking-wide mb-1">{t(locale, 'owner.dashboard.trialing')}</p><p className="text-2xl font-bold text-blue">{trialingCount}</p></Card>
        <Card>
          <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t(locale, 'owner.dashboard.mrr')}</p>
          <p className="text-2xl font-bold text-primary">${(mrrCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
          <p className="text-[10px] text-tertiary mt-1 leading-snug">{t(locale, 'owner.dashboard.mrrHint')}</p>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6 md:mb-8">
        <Card><p className="text-xs text-secondary uppercase tracking-wide mb-1">{t(locale, 'owner.dashboard.totalUsers')}</p><p className="text-2xl font-bold text-primary">{totalUsers}</p></Card>
        <Card><p className="text-xs text-secondary uppercase tracking-wide mb-1">{t(locale, 'owner.dashboard.totalProjects')}</p><p className="text-2xl font-bold text-primary">{totalProjects}</p></Card>
        <Card><p className="text-xs text-secondary uppercase tracking-wide mb-1">{t(locale, 'owner.dashboard.overdueCompanies')}</p><p className={`text-2xl font-bold ${overdueCount > 0 ? 'text-danger' : 'text-primary'}`}>{overdueCount}</p></Card>
      </div>

      {recentActivity.length > 0 && (
        <Card padding="none" className="mb-6 md:mb-8">
          <h2 className="text-sm font-semibold text-primary px-5 pt-4 pb-3">{t(locale, 'owner.dashboard.recentActivity')}</h2>
          <div className="divide-y divide-[var(--border)]">
            {recentActivity.map((a, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-2.5 flex-wrap">
                <p className="flex-1 min-w-[140px] text-sm text-primary truncate">
                  <span className="font-medium">{a.full_name}</span>
                  <span className="text-secondary"> · {a.company?.name ?? '—'}</span>
                </p>
                <Badge variant="gray">{a.role}</Badge>
                <span className="text-xs text-tertiary">
                  {new Date(a.last_login_at).toLocaleDateString(DATE_LOCALE[locale], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card padding="none">
        {!supabaseReady ? (
          <p className="px-5 py-10 text-sm text-secondary text-center">{t(locale, 'owner.dashboard.noSupabase')}</p>
        ) : loadError ? (
          <p className="px-5 py-10 text-sm text-danger text-center">{t(locale, 'owner.dashboard.loadError')}</p>
        ) : companies.length === 0 ? (
          <p className="px-5 py-10 text-sm text-secondary text-center">{t(locale, 'owner.dashboard.noCompanies')}</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {companies.map(c => {
              const bucket = counts.get(c.id) ?? { admins: 0, employees: 0, clients: 0, projects: 0 }
              const overdue = c.months_overdue ?? 0
              const flaggedOverdue = isCompanyOverdue(c.subscription_status, c.months_overdue)
              return (
                <Link
                  key={c.id}
                  href={`/owner/companies/${c.id}`}
                  className="flex items-center gap-3 px-5 py-4 flex-wrap hover:bg-surface-elevated transition-colors"
                >
                  <div className="flex-1 min-w-[160px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-primary truncate">{c.name}</p>
                      {statusBadge(c.subscription_status, locale)}
                      {c.unlimited_override && (
                        <Badge variant="brand">{t(locale, 'owner.companyDetail.unlimitedBadge')}</Badge>
                      )}
                      {c.subscription_status === 'trialing' && c.trial_ends_at && (() => {
                        const daysLeft = Math.ceil((new Date(c.trial_ends_at as string).getTime() - Date.now()) / 86400000)
                        return (
                          <Badge variant={daysLeft <= 3 ? 'amber' : 'gray'}>
                            {daysLeft > 0
                              ? `${daysLeft} ${t(locale, daysLeft === 1 ? 'owner.dashboard.trialDaySingular' : 'owner.dashboard.trialDayPlural')}`
                              : t(locale, 'owner.dashboard.trialExpiredBadge')}
                          </Badge>
                        )
                      })()}
                      {flaggedOverdue && (
                        <Badge variant="red">
                          {overdue > 0
                            ? `${overdue} ${overdue !== 1 ? t(locale, 'owner.dashboard.monthsOverdue') : t(locale, 'owner.dashboard.monthOverdue')}`
                            : t(locale, 'owner.dashboard.statusPastDue')}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-secondary mt-0.5">
                      {c.plan ? `${c.plan.name} · $${(c.plan.price_cents / 100).toFixed(0)}/mo` : t(locale, 'owner.dashboard.noPlan')}
                    </p>
                  </div>
                  <div className="flex gap-4 text-xs text-secondary">
                    <span>{bucket.admins} {bucket.admins !== 1 ? t(locale, 'owner.dashboard.adminPlural') : t(locale, 'owner.dashboard.adminSingular')}</span>
                    <span>{bucket.employees} {bucket.employees !== 1 ? t(locale, 'owner.dashboard.employeePlural') : t(locale, 'owner.dashboard.employeeSingular')}</span>
                    <span>{bucket.clients} {bucket.clients !== 1 ? t(locale, 'owner.dashboard.clientPlural') : t(locale, 'owner.dashboard.clientSingular')}</span>
                    <span>
                      {bucket.projects} {bucket.projects !== 1 ? t(locale, 'owner.dashboard.projectPlural') : t(locale, 'owner.dashboard.projectSingular')}
                      {c.plan?.project_limit != null ? ` / ${c.plan.project_limit}` : ''}
                    </span>
                  </div>
                  <p className="text-xs text-tertiary">
                    {t(locale, 'owner.dashboard.since')} {new Date(c.created_at).toLocaleDateString(DATE_LOCALE[locale], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                  <ChevronRight />
                </Link>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
