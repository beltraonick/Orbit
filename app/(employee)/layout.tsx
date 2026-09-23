import { redirect } from 'next/navigation'
import { getCurrentUser, getImpersonatorToken } from '@/lib/auth/session'
import { touchAccess } from '@/lib/auth/access'
import { createClient } from '@/lib/supabase/server'
import { EmployeeNav } from './EmployeeNav'
import { CompanyProvider } from '@/lib/company-context'
import { PermissionsProvider } from '@/lib/permissions-context'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { OfflineBanner } from '@/components/OfflineBanner'
import { ImpersonationBanner } from '@/components/ImpersonationBanner'
import { SupabaseAuthBridge } from '@/components/SupabaseAuthBridge'
import type { EmployeePermissions } from '@/lib/permissions'

const supabaseReady =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

export default async function EmployeeLayout({ children }: { children: React.ReactNode }) {
  const user = getCurrentUser()

  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')
  if (user.role === 'admin') redirect('/admin/dashboard')
  if (user.role === 'client') redirect('/client')
  if (user.role === 'owner') redirect('/owner/dashboard')

  if (!getImpersonatorToken()) await touchAccess(user.id, user.company_id)

  let permissions: EmployeePermissions = {}
  if (supabaseReady) {
    try {
      const supabase = createClient()
      const { data: profile } = await supabase
        .from('profiles')
        .select('permissions')
        .eq('email', user.email)
        .eq('company_id', user.company_id)
        .maybeSingle()
      permissions = (profile?.permissions as EmployeePermissions | null) ?? {}
    } catch {
      // silent — permission-gated features just stay hidden
    }
  }

  return (
    <LocaleProvider locale={user.language}>
      <CompanyProvider companyId={user.company_id as string}>
        <PermissionsProvider permissions={permissions}>
          <div className="min-h-screen bg-background pb-20 safe-top">
            <SupabaseAuthBridge />
            <OfflineBanner />
            {children}
            <EmployeeNav />
            <ImpersonationBanner />
          </div>
        </PermissionsProvider>
      </CompanyProvider>
    </LocaleProvider>
  )
}
