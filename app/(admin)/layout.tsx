import { redirect } from 'next/navigation'
import { getCurrentUser, getImpersonatorToken } from '@/lib/auth/session'
import { touchAccess } from '@/lib/auth/access'
import { Sidebar } from '@/components/admin/Sidebar'
import { CompanyProvider } from '@/lib/company-context'
import { UserProvider } from '@/lib/user-context'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { OfflineBanner } from '@/components/OfflineBanner'
import { ImpersonationBanner } from '@/components/ImpersonationBanner'
import { SupabaseAuthBridge } from '@/components/SupabaseAuthBridge'
import { getPendingRequests } from '@/app/actions/membership'
import { createClient } from '@/lib/supabase/server'
import { getAttendanceStatus } from '@/app/actions/scheduleActions'
import { countUnseenPayApprovals } from '@/app/actions/payApprovalActions'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = getCurrentUser()

  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')
  if (user.role === 'client') redirect('/client')
  if (user.role === 'owner') redirect('/owner/dashboard')
  if (user.role !== 'admin') redirect('/home')

  // Skip while the owner is impersonating — otherwise their own
  // browsing would masquerade as this account's real activity.
  if (!getImpersonatorToken()) await touchAccess(user.id, user.company_id)

  const [{ requests }, attendance, newPayApprovals] = await Promise.all([
    getPendingRequests(),
    getAttendanceStatus(),
    countUnseenPayApprovals(),
  ])
  const pendingCount = requests?.length ?? 0
  const alerts = {
    notClockedIn: attendance?.missing.length ?? 0,
    dayOffRequests: attendance?.pendingRequests ?? 0,
    newPayApprovals,
  }

  let auditCount = 0
  try {
    const supabase = createClient()
    const { count } = await supabase
      .from('task_audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', user.company_id)
      .eq('is_read', false)
    auditCount = count ?? 0
  } catch {
    // table may not exist yet
  }

  return (
    // Every non-owner profile always has a company_id — owner is the
    // only role that isn't scoped to one, and it's redirected above.
    <LocaleProvider locale={user.language}>
      <CompanyProvider companyId={user.company_id as string}>
        <UserProvider user={{ id: user.id, name: user.full_name }}>
          <div className="flex h-screen bg-background overflow-hidden">
            <SupabaseAuthBridge />
            <OfflineBanner />
            <Sidebar user={user} pendingCount={pendingCount} auditCount={auditCount} alerts={alerts} />
            {/* mobile top = 3.5rem + safe-area-top via .pt-safe-header; resets at md */}
            <main className="flex-1 md:ml-[240px] overflow-y-auto pt-safe-header pb-20 md:pb-0">
              {children}
            </main>
            <ImpersonationBanner />
          </div>
        </UserProvider>
      </CompanyProvider>
    </LocaleProvider>
  )
}
