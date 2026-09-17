import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { hasPermission, type EmployeePermissions } from '@/lib/permissions'
import { t } from '@/lib/i18n/translate'
import { TeamClockIn } from '../../projects/[id]/TeamClockIn'

const supabaseReady =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

export default async function TeamCheckinPage() {
  const user = getCurrentUser()
  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')

  const locale = user.language

  if (supabaseReady) {
    try {
      const supabase = createClient()
      const { data: profile } = await supabase
        .from('profiles')
        .select('permissions')
        .eq('email', user.email)
        .eq('company_id', user.company_id)
        .maybeSingle()

      const permissions = (profile?.permissions as EmployeePermissions | null) ?? {}
      if (user.role !== 'admin' && !hasPermission(permissions, 'checkin_team')) redirect('/team')
    } catch {
      // fail open to the same permission-gated component below
    }
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-4 pt-6 mb-2">
        <h1 className="text-xl font-bold text-primary tracking-tight">{t(locale, 'employee.team.checkinTitle')}</h1>
        <p className="text-sm text-secondary mt-0.5">{t(locale, 'employee.team.checkinPageSubtitle')}</p>
      </div>

      {/* No projectId — this is the whole company's team, employees and
          workers alike, not scoped to one job site. */}
      <TeamClockIn />
    </div>
  )
}
