import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
// Legitimately cross-company: the platform owner can open any company's
// project, so this can't be scoped by the single-company_id JWT claim the
// regular bridged client sends (null for an owner, so the company-scoped
// RLS policy silently returns zero rows for every table).
import { createServiceRoleClient as createClient } from '@/lib/supabase/service-role'
import { t } from '@/lib/i18n/translate'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { PhotoGrid } from './PhotoGrid'

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

function taskStatusVariant(status: string): 'green' | 'blue' | 'gray' | 'amber' {
  if (status === 'completed') return 'green'
  if (status === 'in_progress') return 'blue'
  if (status === 'blocked') return 'amber'
  return 'gray'
}

export default async function OwnerProjectDetailPage({ params }: { params: { id: string; projectId: string } }) {
  const user = getCurrentUser()
  if (!user || user.role !== 'owner') redirect('/login')

  const locale = user.language
  const supabase = createClient()

  const [{ data: project }, { data: tasks }, { data: photos }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, name, status, progress, address, client_name, client_email, client_phone, budget, start_date, created_at, company:company_id(name)')
      .eq('id', params.projectId)
      .eq('company_id', params.id)
      .maybeSingle(),
    supabase
      .from('tasks')
      .select('id, title, status, priority, assigned_employee:assigned_to(full_name)')
      .eq('project_id', params.projectId)
      .order('created_at', { ascending: false }),
    supabase
      .from('project_photos')
      .select('id, storage_path, tag, caption, created_at')
      .eq('project_id', params.projectId)
      .order('created_at', { ascending: false })
      .limit(60),
  ])

  const backHref = `/owner/companies/${params.id}`

  if (!project) {
    return (
      <div className="p-4 md:p-8 max-w-[1000px]">
        <Link href={backHref} className="text-sm text-secondary hover:text-primary transition-colors">
          ‹ {t(locale, 'owner.projectDetail.back')}
        </Link>
        <p className="mt-6 text-sm text-secondary">{t(locale, 'owner.projectDetail.notFound')}</p>
      </div>
    )
  }

  const company = project.company as unknown as { name: string } | null

  return (
    <div className="p-4 md:p-8 max-w-[1000px] pb-20">
      <Link href={backHref} className="text-sm text-secondary hover:text-primary transition-colors">
        ‹ {company?.name ?? t(locale, 'owner.projectDetail.back')}
      </Link>

      <div className="mt-3 mb-6 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{project.name}</h1>
        <Badge variant={projectStatusVariant(project.status)}>{project.status}</Badge>
        <span className="text-xs text-tertiary">{project.progress ?? 0}%</span>
      </div>

      <Card className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {project.client_name && (
            <div>
              <p className="text-xs text-secondary uppercase tracking-wide mb-0.5">{t(locale, 'owner.projectDetail.client')}</p>
              <p className="text-primary">{project.client_name}</p>
              {(project.client_email || project.client_phone) && (
                <p className="text-xs text-tertiary">{[project.client_email, project.client_phone].filter(Boolean).join(' · ')}</p>
              )}
            </div>
          )}
          {project.address && (
            <div>
              <p className="text-xs text-secondary uppercase tracking-wide mb-0.5">{t(locale, 'owner.projectDetail.address')}</p>
              <p className="text-primary">{project.address}</p>
            </div>
          )}
          {project.budget != null && (
            <div>
              <p className="text-xs text-secondary uppercase tracking-wide mb-0.5">{t(locale, 'owner.projectDetail.budget')}</p>
              <p className="text-primary">${Number(project.budget).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            </div>
          )}
          {project.start_date && (
            <div>
              <p className="text-xs text-secondary uppercase tracking-wide mb-0.5">{t(locale, 'owner.projectDetail.startDate')}</p>
              <p className="text-primary">{new Date(project.start_date).toLocaleDateString(DATE_LOCALE[locale], { month: 'short', day: 'numeric', year: 'numeric' })}</p>
            </div>
          )}
        </div>
      </Card>

      <Card padding="none" className="mb-6">
        <h2 className="text-sm font-semibold text-primary px-5 pt-4 pb-3">
          {photos?.length ?? 0} {t(locale, 'owner.projectDetail.photosCount')}
        </h2>
        {!photos || photos.length === 0 ? (
          <p className="px-5 py-8 text-sm text-secondary text-center">{t(locale, 'owner.projectDetail.noPhotos')}</p>
        ) : (
          <PhotoGrid
            photos={photos.map(p => ({
              id: p.id,
              url: photoUrl(p.storage_path),
              tag: p.tag,
              caption: p.caption,
              createdAt: p.created_at,
            }))}
          />
        )}
      </Card>

      <Card padding="none">
        <h2 className="text-sm font-semibold text-primary px-5 pt-4 pb-3">{t(locale, 'owner.projectDetail.tasksTitle')}</h2>
        {!tasks || tasks.length === 0 ? (
          <p className="px-5 py-8 text-sm text-secondary text-center">{t(locale, 'owner.projectDetail.noTasks')}</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {tasks.map(taskRow => {
              const assignee = taskRow.assigned_employee as unknown as { full_name: string } | null
              return (
                <div key={taskRow.id} className="flex items-center gap-3 px-5 py-3.5 flex-wrap">
                  <p className="flex-1 min-w-[160px] text-sm font-medium text-primary truncate">{taskRow.title}</p>
                  <Badge variant={taskStatusVariant(taskRow.status)}>{taskRow.status}</Badge>
                  <span className="text-xs text-secondary w-28 truncate">{assignee?.full_name ?? '—'}</span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
