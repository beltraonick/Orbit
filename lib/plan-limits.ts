import type { SupabaseClient } from '@supabase/supabase-js'
import { accessLimits, getCompanyAccess } from '@/lib/billing'

interface LimitResult {
  allowed: boolean
  limit: number | null // null = unlimited
  used?: number
}

// Projects are unlimited on every plan (Crew / Pro / Business).
export async function checkProjectLimit(_supabase: SupabaseClient, _companyId: string): Promise<LimitResult> {
  return { allowed: true, limit: null }
}

// Orbit AI conversations are no longer tied to the project cap: unlimited
// (fair use) on the plans that include Orbit AI. Whether the plan includes
// it at all is checked by the AI routes (accessHasFeature(..., 'ai')).
export async function checkChatLimit(_supabase: SupabaseClient, _companyId: string): Promise<LimitResult> {
  return { allowed: true, limit: null }
}

/**
 * Field team = active employees with a login + active workers without the
 * app. Admins are counted separately and never take a field-team seat.
 */
export async function countFieldTeam(supabase: SupabaseClient, companyId: string): Promise<number> {
  const [employees, workers] = await Promise.all([
    supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('role', 'employee')
      .eq('status', 'active'),
    supabase
      .from('workers')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('status', 'active'),
  ])
  return (employees.count ?? 0) + (workers.count ?? 0)
}

export async function countAdmins(supabase: SupabaseClient, companyId: string): Promise<number> {
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('role', 'admin')
    .eq('status', 'active')
  return count ?? 0
}

/** Can one more person of this kind be added? ('employee' covers workers too.) */
export async function checkRoleLimit(
  supabase: SupabaseClient,
  companyId: string,
  role: 'admin' | 'employee'
): Promise<LimitResult> {
  const access = await getCompanyAccess(supabase, companyId)
  const limits = accessLimits(access)
  const limit = role === 'admin' ? limits.admins : limits.fieldTeam
  if (limit == null) return { allowed: true, limit: null }

  const used = role === 'admin' ? await countAdmins(supabase, companyId) : await countFieldTeam(supabase, companyId)
  return { allowed: used < limit, limit, used }
}
