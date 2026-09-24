import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { hasPermission, type EmployeePermissions } from '@/lib/permissions'
import { t } from '@/lib/i18n/translate'
import { ExtraForm, type ExtraProject, type ExtraOrder } from './ExtraForm'

const supabaseReady =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

export default async function TeamExtrasPage() {
  const user = getCurrentUser()
  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')

  const locale = user.language
  let profileId: string | null = null
  let projects: ExtraProject[] = []
  let orders: ExtraOrder[] = []

  if (supabaseReady) {
    try {
      const supabase = createClient()
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, permissions')
        .eq('email', user.email)
        .eq('company_id', user.company_id)
        .maybeSingle()

      const permissions = (profile?.permissions as EmployeePermissions | null) ?? {}
      if (!profile || !hasPermission(permissions, 'create_extras')) redirect('/team')
      profileId = profile.id

      const { data: assignments } = await supabase
        .from('project_members')
        .select('project_id, project:project_id(id, name)')
        .eq('profile_id', profileId)

      projects = (assignments ?? [])
        .map((a: { project: unknown }) => a.project as ExtraProject | null)
        .filter((p): p is ExtraProject => !!p)

      const projectIds = projects.map(p => p.id)
      if (projectIds.length > 0) {
        const { data: cos } = await supabase
          .from('change_orders')
          .select('id, title, amount, status, created_at, project:project_id(name)')
          .in('project_id', projectIds)
          .order('created_at', { ascending: false })
          .limit(20)
        orders = (cos ?? []) as unknown as ExtraOrder[]
      }
    } catch {
      // silent
    }
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-primary tracking-tight">{t(locale, 'employee.team.extrasTitle')}</h1>
        <p className="text-sm text-secondary mt-0.5">{t(locale, 'employee.team.extrasPageSubtitle')}</p>
      </div>

      <ExtraForm
        profileId={profileId}
        companyId={user.company_id as string}
        projects={projects}
        initialOrders={orders}
        supabaseReady={!!supabaseReady}
      />
    </div>
  )
}
