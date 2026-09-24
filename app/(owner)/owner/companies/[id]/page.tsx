import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
// Legitimately cross-company: the platform owner can open any company's
// page, so this can't be scoped by the single-company_id JWT claim the
// regular bridged client sends (null for an owner, so the company-scoped
// RLS policy silently returns zero rows for every table).
import { createServiceRoleClient as createClient } from '@/lib/supabase/service-role'
import { t } from '@/lib/i18n/translate'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { subscriptionStatusKey, subscriptionStatusVariant } from '@/lib/owner-status'
import { BillingForm } from './BillingForm'
import { UnlimitedOverrideToggle } from './UnlimitedOverrideToggle'
import { PeopleTable } from './PeopleTable'
import { PhotoThumb } from './PhotoThumb'

const DATE_LOCALE: Record<string, string> = { en: 'en-US', pt: 'pt-BR', es: 'es-ES' }
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function photoUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/project-photos/${path}`
}

function projectStatusVariant(status: string): 'green' | 'blue' | 'gray' | 'amber' {
  if (status === 'active') return 'green'
  if (status === 'completed') return 'blue'
  if (status === 'on_hold') return 'amber'
  return 'gray'
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-tertiary flex-shrink-0">
      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
    </svg>
  )
}

export default async function OwnerCompanyDetailPage({ params }: { params: { id: string } }) {
  const user = getCurrentUser()
  if (!user || user.role !== 'owner') redirect('/login')

  const locale = user.language
  const supabase = createClient()

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [
    { data: company },
    { data: people },
    { data: projects },
    { data: plans },
    { data: pendingRequests },
    { data: recentLogins },
    { data: allTasks },
    { data: allPhotos },
  ] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, subscription_status, months_overdue, trial_ends_at, owner_notes, created_at, plan_id, unlimited_override, plan:plan_id(name, price_cents, project_limit)')
      .eq('id', params.id)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('id, full_name, email, phone, position, role, auth_status, last_login_at')
      .eq('company_id', params.id)
      .order('role')
      .order('full_name'),
    supabase
      .from('projects')
      .select('id, name, status, progress, client_name, created_at')
      .eq('company_id', params.id)
      .order('created_at', { ascending: false }),
    supabase.from('plans').select('id, name, price_cents').order('price_cents'),
    supabase
      .from('membership_requests')
      .select('id, created_at, profile:profile_id(full_name, email)')
      .eq('company_id', params.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    // Fetched once (most recent first) and used both to count this
    // month's accesses and to show each person's last few real access
    // times — not just a single "last login" timestamp.
    supabase
      .from('login_events')
      .select('profile_id, created_at')
      .eq('company_id', params.id)
      .order('created_at', { ascending: false })
      .limit(300),
    // Fetched once for the whole company and bucketed below, so each
    // project row can show its own task/photo summary without making
    // the admin click into every single project just to see the basics.
    supabase.from('tasks').select('project_id, status').eq('company_id', params.id),
    supabase.from('project_photos').select('project_id, storage_path').eq('company_id', params.id).order('created_at', { ascending: false }),
  ])

  const accessesThisMonth: Record<string, number> = {}
  const accessHistory: Record<string, string[]> = {}
  for (const row of recentLogins ?? []) {
    if (new Date(row.created_at) >= monthStart) {
      accessesThisMonth[row.profile_id] = (accessesThisMonth[row.profile_id] ?? 0) + 1
    }
    const history = accessHistory[row.profile_id] ?? (accessHistory[row.profile_id] = [])
    if (history.length < 5) history.push(row.created_at)
  }

  const projectSummaries = new Map<string, { taskTotal: number; taskDone: number; photoPaths: string[]; photoCount: number }>()
  for (const t of allTasks ?? []) {
    if (!t.project_id) continue
    const s = projectSummaries.get(t.project_id) ?? { taskTotal: 0, taskDone: 0, photoPaths: [], photoCount: 0 }
    s.taskTotal++
    if (t.status === 'completed') s.taskDone++
    projectSummaries.set(t.project_id, s)
  }
  for (const p of allPhotos ?? []) {
    if (!p.project_id) continue
    const s = projectSummaries.get(p.project_id) ?? { taskTotal: 0, taskDone: 0, photoPaths: [], photoCount: 0 }
    s.photoCount++
    if (s.photoPaths.length < 3) s.photoPaths.push(p.storage_path)
    projectSummaries.set(p.project_id, s)
  }

  if (!company) {
    return (
      <div className="p-4 md:p-8 max-w-[1000px]">
        <Link href="/owner/dashboard" className="text-sm text-secondary hover:text-primary transition-colors">
          ‹ {t(locale, 'owner.companyDetail.back')}
        </Link>
        <p className="mt-6 text-sm text-secondary">{t(locale, 'owner.companyDetail.notFound')}</p>
      </div>
    )
  }

  const plan = company.plan as unknown as { name: string; price_cents: number; project_limit: number | null } | null

  return (
    <div className="p-4 md:p-8 max-w-[1000px] pb-20">
      <Link href="/owner/dashboard" className="text-sm text-secondary hover:text-primary transition-colors">
        ‹ {t(locale, 'owner.companyDetail.back')}
      </Link>

      <div className="mt-3 mb-6 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{company.name}</h1>
        <Badge variant={subscriptionStatusVariant(company.subscription_status)}>
          {t(locale, subscriptionStatusKey(company.subscription_status))}
        </Badge>
        {company.subscription_status === 'trialing' && company.trial_ends_at && (() => {
          const daysLeft = Math.ceil((new Date(company.trial_ends_at).getTime() - Date.now()) / 86400000)
          return (
            <Badge variant={daysLeft <= 3 ? 'amber' : 'gray'}>
              {daysLeft > 0
                ? `${daysLeft} ${t(locale, daysLeft === 1 ? 'owner.dashboard.trialDaySingular' : 'owner.dashboard.trialDayPlural')}`
                : t(locale, 'owner.dashboard.trialExpiredBadge')}
            </Badge>
          )
        })()}
        <Badge variant="gray">
          {plan ? `${plan.name} · $${(plan.price_cents / 100).toFixed(0)}/mo` : t(locale, 'owner.dashboard.noPlan')}
        </Badge>
        {company.unlimited_override && (
          <Badge variant="brand">{t(locale, 'owner.companyDetail.unlimitedBadge')}</Badge>
        )}
        <span className="text-xs text-tertiary">
          {t(locale, 'owner.dashboard.since')} {new Date(company.created_at).toLocaleDateString(DATE_LOCALE[locale], { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-primary mb-3">{t(locale, 'owner.companyDetail.unlimitedTitle')}</h2>
        <UnlimitedOverrideToggle companyId={company.id} initialEnabled={company.unlimited_override ?? false} />
      </Card>

      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-primary mb-3">{t(locale, 'owner.companyDetail.billingTitle')}</h2>
        <BillingForm
          companyId={company.id}
          initialStatus={company.subscription_status}
          initialMonthsOverdue={company.months_overdue ?? 0}
          initialNotes={company.owner_notes ?? ''}
          initialPlanId={company.plan_id}
          plans={plans ?? []}
        />
      </Card>

      {pendingRequests && pendingRequests.length > 0 && (
        <Card className="mb-6">
          <h2 className="text-sm font-semibold text-primary mb-3">{t(locale, 'owner.companyDetail.pendingRequestsTitle')}</h2>
          <div className="space-y-2">
            {pendingRequests.map(r => {
              const profile = r.profile as unknown as { full_name: string; email: string } | null
              return (
                <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-primary">{profile?.full_name ?? '—'} <span className="text-secondary">· {profile?.email}</span></span>
                  <span className="text-xs text-tertiary">
                    {new Date(r.created_at).toLocaleDateString(DATE_LOCALE[locale], { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card padding="none" className="mb-6">
        <h2 className="text-sm font-semibold text-primary px-5 pt-4 pb-3">{t(locale, 'owner.companyDetail.peopleTitle')}</h2>
        <PeopleTable people={people ?? []} accessesThisMonth={accessesThisMonth} accessHistory={accessHistory} />
      </Card>

      <Card padding="none">
        <h2 className="text-sm font-semibold text-primary px-5 pt-4 pb-3">{t(locale, 'owner.companyDetail.projectsTitle')}</h2>
        {!projects || projects.length === 0 ? (
          <p className="px-5 py-8 text-sm text-secondary text-center">{t(locale, 'owner.companyDetail.noProjects')}</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {projects.map(p => {
              const summary = projectSummaries.get(p.id) ?? { taskTotal: 0, taskDone: 0, photoPaths: [], photoCount: 0 }
              return (
                <Link
                  key={p.id}
                  href={`/owner/companies/${company.id}/projects/${p.id}`}
                  className="flex items-center gap-3 px-5 py-3.5 flex-wrap hover:bg-surface-elevated transition-colors"
                >
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-primary truncate">{p.name}</p>
                      <Badge variant={projectStatusVariant(p.status)}>{p.status}</Badge>
                    </div>
                    <p className="text-xs text-secondary mt-0.5">
                      {p.client_name ? `${p.client_name} · ` : ''}
                      {summary.taskTotal > 0
                        ? `${summary.taskDone}/${summary.taskTotal} ${t(locale, 'owner.companyDetail.tasksInline')}`
                        : t(locale, 'owner.companyDetail.noTasksInline')}
                      {summary.photoCount > 0 ? ` · ${summary.photoCount} ${t(locale, 'owner.dashboard.photoInline')}` : ''}
                    </p>
                  </div>
                  {summary.photoPaths.length > 0 && (
                    <div className="flex -space-x-2">
                      {summary.photoPaths.map((path, i) => (
                        <PhotoThumb
                          key={i}
                          src={photoUrl(path)}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover border-2 border-surface"
                        />
                      ))}
                    </div>
                  )}
                  <span className="text-xs text-secondary w-14 text-right">{p.progress ?? 0}%</span>
                  <span className="text-xs text-tertiary">
                    {new Date(p.created_at).toLocaleDateString(DATE_LOCALE[locale], { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
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
