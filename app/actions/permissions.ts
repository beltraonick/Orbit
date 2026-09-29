'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import type { EmployeePermissions } from '@/lib/permissions'

// Re-reads the logged-in employee's permission toggles from the profile row.
// The employee layout only fetches these once per app load, so an admin
// revoking a permission (e.g. Supervisor) doesn't take effect until the
// employee's app restarts. PermissionsProvider calls this periodically and
// on focus so a revocation lands within about a minute, or immediately the
// next time the employee reopens the app.
export async function getMyPermissions(): Promise<EmployeePermissions> {
  const user = getCurrentUser()
  if (!user) return {}

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('permissions')
    .eq('email', user.email)
    .eq('company_id', user.company_id)
    .maybeSingle()

  return (profile?.permissions as EmployeePermissions | null) ?? {}
}
