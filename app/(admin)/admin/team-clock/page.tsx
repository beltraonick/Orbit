import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { t } from '@/lib/i18n/translate'
import { TeamClockIn } from '@/app/(employee)/projects/[id]/TeamClockIn'

export default async function AdminTeamClockPage() {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') redirect('/login')

  const locale = user.language

  return (
    <div className="max-w-lg mx-auto">
      <div className="px-4 pt-6 mb-2">
        <h1 className="text-xl font-bold text-primary tracking-tight">
          {t(locale, 'employee.team.checkinTitle')}
        </h1>
        <p className="text-sm text-secondary mt-0.5">
          {t(locale, 'employee.team.checkinPageSubtitle')}
        </p>
      </div>
      <TeamClockIn />
    </div>
  )
}
