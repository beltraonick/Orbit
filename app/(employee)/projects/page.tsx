import { getCurrentUser } from '@/lib/auth/session'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { t } from '@/lib/i18n/translate'
import Link from 'next/link'
import { hasPermission, type EmployeePermissions } from '@/lib/permissions'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function coverUrl(path: string | null) {
  if (!path) return null
  return `${SUPABASE_URL}/storage/v1/object/public/project-photos/${path}`
}

const supabaseReady =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

export default async function EmployeeProjectsPage() {
  const user = getCurrentUser()
  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')

  const locale = user.language

  type ProjectRow = {
    id: string
    name: string
    status: string
    progress: number
    cover_image_path: string | null
    taskCount: number
  }

  let projects: ProjectRow[] = []

  if (supabaseReady) {
    try {
      const supabase = createClient()

      // Get profile id
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, permissions')
        .eq('email', user.email)
        .eq('company_id', user.company_id)
        .maybeSingle()

      if (profile) {
        // "Supervisor view" gives access to every project's kanban (see the
        // permission's description in Admin → Employees), so it lists all
        // company projects. Everyone else sees the projects they're a member of.
        const isSupervisor = hasPermission(profile.permissions as EmployeePermissions | null, 'supervisor')
        type ProjectRow = { id: string; name: string; status: string; progress: number; cover_image_path: string | null }
        let projectRows: ProjectRow[]
        if (isSupervisor) {
          const { data: all } = await supabase
            .from('projects')
            .select('id, name, status, progress, cover_image_path')
            .eq('company_id', user.company_id)
            .order('created_at', { ascending: false })
          projectRows = (all ?? []) as ProjectRow[]
        } else {
          // Fetch projects this employee is a member of
          const { data: members } = await supabase
            .from('project_members')
            .select('project_id, projects(id, name, status, progress, cover_image_path)')
            .eq('profile_id', profile.id)

          projectRows = (members ?? [])
            .map((m: { project_id: string; projects: unknown }) => m.projects)
            .filter(Boolean) as ProjectRow[]
        }

        // For each project, count tasks assigned to this employee
        if (projectRows.length > 0) {
          const { data: assignments } = await supabase
            .from('task_assignments')
            .select('task_id')
            .eq('profile_id', profile.id)

          const assignedIds = new Set((assignments ?? []).map((a: { task_id: string }) => a.task_id))

          // Supervisors see every open task on the project's kanban; others
          // only the tasks assigned to them.
          let tasksQuery = supabase
            .from('tasks')
            .select('id, project_id, status')
            .in('project_id', projectRows.map(p => p.id))
            .neq('status', 'completed')
          if (!isSupervisor) {
            tasksQuery = tasksQuery.in('id', assignedIds.size > 0 ? Array.from(assignedIds) : ['__none__'])
          }
          const { data: tasks } = await tasksQuery

          const taskCountByProject: Record<string, number> = {}
          for (const task of (tasks ?? [])) {
            taskCountByProject[task.project_id] = (taskCountByProject[task.project_id] ?? 0) + 1
          }

          projects = projectRows.map(p => ({
            ...p,
            taskCount: taskCountByProject[p.id] ?? 0,
          }))
        }
      }
    } catch {
      // DB not ready — show empty state
    }
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-4 pt-8 pb-4 max-w-lg mx-auto">
        <h1 className="text-xl font-bold text-primary tracking-tight mb-6">
          {t(locale, 'employee.projects.title')}
        </h1>

        {!supabaseReady ? (
          <p className="text-sm text-secondary text-center py-12">
            {t(locale, 'employee.projects.connectSupabase')}
          </p>
        ) : projects.length === 0 ? (
          <p className="text-sm text-secondary text-center py-12">
            {t(locale, 'employee.projects.noProjects')}
          </p>
        ) : (
          <div className="space-y-3">
            {projects.map(proj => {
              const cover = coverUrl(proj.cover_image_path)
              const taskPlural = proj.taskCount === 1 ? '' : 's'
              const taskLabel = t(locale, 'employee.projects.tasks')
                .replace('{n}', String(proj.taskCount))
                .replace('{plural}', taskPlural)
              const progressLabel = t(locale, 'employee.projects.progress')
                .replace('{n}', String(proj.progress ?? 0))

              return (
                <Link
                  key={proj.id}
                  href={`/projects/${proj.id}`}
                  className="block bg-surface rounded-[16px] border border-[var(--border)] overflow-hidden active:opacity-70 transition-opacity"
                >
                  {cover && (
                    <div className="h-32 w-full overflow-hidden">
                      <img
                        src={cover}
                        alt={proj.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="text-sm font-semibold text-primary">{proj.name}</p>
                        <p className="text-xs text-secondary mt-0.5">{taskLabel}</p>
                      </div>
                      <span className="text-xs font-semibold text-secondary flex-shrink-0">{progressLabel}</span>
                    </div>
                    {/* Progress bar */}
                    <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${proj.progress ?? 0}%`,
                          background: (proj.progress ?? 0) >= 100
                            ? 'rgb(var(--color-green))'
                            : 'rgb(var(--color-brand))',
                        }}
                      />
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
