import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/translate'
import Link from 'next/link'
import { SupervisorKanban } from './SupervisorKanban'
import { hasPermission, type EmployeePermissions } from '@/lib/permissions'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function coverUrl(path: string | null) {
  if (!path) return null
  return `${SUPABASE_URL}/storage/v1/object/public/project-photos/${path}`
}

const supabaseReady =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

const STATUS_STYLES: Record<string, string> = {
  todo: 'bg-[var(--color-surface-elevated)] text-secondary border border-[var(--border)]',
  pending: 'bg-[var(--color-surface-elevated)] text-secondary border border-[var(--border)]',
  in_progress: 'bg-blue/10 text-blue',
  done: 'bg-green/10 text-green',
  completed: 'bg-green/10 text-green',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

type TaskRow = {
  id: string
  title: string
  status: string
  area: string | null
  due_date: string | null
  checklist: { text: string; done: boolean }[] | null
}

export default async function EmployeeProjectDetailPage({ params }: { params: { id: string } }) {
  const user = getCurrentUser()
  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')

  const locale = user.language
  const projectId = params.id

  let projectName = ''
  let projectProgress = 0
  let projectAddress: string | null = null
  let coverPath: string | null = null
  let tasks: TaskRow[] = []
  let found = false
  let isSupervisor = false
  let profileFullName = ''

  if (supabaseReady) {
    try {
      const supabase = createClient()

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, permissions')
        .eq('email', user.email)
        .eq('company_id', user.company_id)
        .maybeSingle()

      if (profile) {
        profileFullName = profile.full_name ?? ''
        isSupervisor = hasPermission(profile.permissions as EmployeePermissions | null, 'supervisor')

        const { data: member } = await supabase
          .from('project_members')
          .select('project_id')
          .eq('profile_id', profile.id)
          .eq('project_id', projectId)
          .maybeSingle()

        if (member) {
          found = true

          const { data: proj } = await supabase
            .from('projects')
            .select('name, status, progress, address, cover_image_path')
            .eq('id', projectId)
            .maybeSingle()

          if (proj) {
            projectName = proj.name
            projectProgress = proj.progress ?? 0
            projectAddress = proj.address ?? null
            coverPath = proj.cover_image_path ?? null
          }

          if (!isSupervisor) {
            const { data: assignments } = await supabase
              .from('task_assignments')
              .select('task_id')
              .eq('profile_id', profile.id)

            const assignedIds = (assignments ?? []).map((a: { task_id: string }) => a.task_id)

            if (assignedIds.length > 0) {
              const { data: taskRows } = await supabase
                .from('tasks')
                .select('id, title, status, area, due_date, checklist')
                .eq('project_id', projectId)
                .in('id', assignedIds)
                .order('created_at', { ascending: false })
              tasks = (taskRows ?? []) as TaskRow[]
            }
          }
        }
      }
    } catch {
      // silent
    }
  }

  if (!found) redirect('/projects')

  const cover = coverUrl(coverPath)

  // Supervisor gets the full kanban (client component handles its own data)
  if (isSupervisor) {
    return (
      <div className="min-h-screen bg-background">
        {cover && (
          <div className="h-36 w-full overflow-hidden relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={cover} alt={projectName} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            <div className="absolute bottom-3 left-4 right-4">
              <Link
                href="/projects"
                className="inline-flex items-center gap-1 text-xs text-white/80 hover:text-white mb-1 transition-colors"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {t(locale, 'employee.projects.back')}
              </Link>
              <h1 className="text-lg font-bold text-white tracking-tight">{projectName}</h1>
              {projectAddress && <p className="text-xs text-white/70">{projectAddress}</p>}
            </div>
          </div>
        )}
        {!cover && (
          <div className="px-4 pt-5 pb-2 max-w-screen-xl mx-auto">
            <Link
              href="/projects"
              className="inline-flex items-center gap-1.5 text-sm text-secondary mb-3 hover:text-primary transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              {t(locale, 'employee.projects.back')}
            </Link>
            <h1 className="text-xl font-bold text-primary tracking-tight">{projectName}</h1>
            {projectAddress && <p className="text-sm text-secondary mt-0.5">{projectAddress}</p>}
          </div>
        )}

        <SupervisorKanban
          projectId={projectId}
          profileName={profileFullName}
        />
      </div>
    )
  }

  // Regular employee: read-only task list
  return (
    <div className="min-h-screen bg-background pb-24">
      {cover && (
        <div className="h-44 w-full overflow-hidden relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt={projectName} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
        </div>
      )}

      <div className="px-4 max-w-lg mx-auto">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-sm text-secondary mt-5 mb-4 hover:text-primary transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          {t(locale, 'employee.projects.back')}
        </Link>

        <div className="mb-5">
          <h1 className="text-xl font-bold text-primary tracking-tight">{projectName}</h1>
          {projectAddress && (
            <p className="text-sm text-secondary mt-0.5">{projectAddress}</p>
          )}
        </div>

        {/* Progress */}
        <div className="bg-surface rounded-[14px] border border-[var(--border)] p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-secondary">
              {t(locale, 'employee.projects.progress').replace('{n}', String(projectProgress))}
            </span>
            <span className="text-sm font-bold text-primary">{projectProgress}%</span>
          </div>
          <div className="h-2 bg-surface-elevated rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${projectProgress}%`,
                background: projectProgress >= 100
                  ? 'rgb(var(--color-green))'
                  : 'rgb(var(--color-brand))',
              }}
            />
          </div>
        </div>

        <h2 className="text-sm font-semibold text-primary mb-3">
          {t(locale, 'employee.projects.myTasks')}
        </h2>

        {tasks.length === 0 ? (
          <p className="text-sm text-secondary text-center py-10">
            {t(locale, 'employee.projects.noTasks')}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {tasks.map(task => {
              const done = (task.checklist ?? []).filter((c: { done: boolean }) => c.done).length
              const total = (task.checklist ?? []).length
              const statusStyle = STATUS_STYLES[task.status] ?? STATUS_STYLES.pending

              return (
                <div
                  key={task.id}
                  className="bg-surface rounded-[14px] border border-[var(--border)] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-medium text-primary leading-snug flex-1">{task.title}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${statusStyle}`}>
                      {task.status.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {task.area && (
                      <span className="text-xs text-secondary bg-surface-elevated px-2 py-0.5 rounded-full">
                        {task.area}
                      </span>
                    )}
                    {task.due_date && (
                      <span className="text-xs text-secondary">
                        {new Date(task.due_date).toLocaleDateString(locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                    {total > 0 && (
                      <span className="text-xs text-secondary">
                        ✓ {done}/{total}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
