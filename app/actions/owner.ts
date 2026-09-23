'use server'

// Every function here is gated by requireOwner() before touching Supabase,
// and is legitimately cross-company by design (the platform owner manages
// any company/profile) — so it uses the service role rather than the
// company-scoped anon/authenticated bridge.
import { createServiceRoleClient as createClient } from '@/lib/supabase/service-role'
import { hashPassword } from '@/lib/auth/crypto'
import {
  getCurrentUser,
  getSessionCookieValue,
  setSessionCookie,
  setImpersonatorCookie,
  getImpersonatorToken,
  clearImpersonatorCookie,
  verifyToken,
} from '@/lib/auth/session'
import type { SessionUser, UserRole, UserStatus } from '@/lib/auth/types'

function requireOwner(): SessionUser | null {
  const user = getCurrentUser()
  if (!user || user.role !== 'owner') return null
  return user
}

export async function updateCompanyBilling(
  companyId: string,
  data: { subscription_status?: string; months_overdue?: number; owner_notes?: string; plan_id?: string | null }
): Promise<{ error?: string }> {
  if (!requireOwner()) return { error: 'Not authorized.' }

  const supabase = createClient()
  const { error } = await supabase.from('companies').update(data).eq('id', companyId)
  if (error) return { error: error.message }
  return {}
}

// One-click Master override: grants (or revokes) unlimited access for a
// single company regardless of its plan tier. Distinct from picking a
// bigger plan in updateCompanyBilling — this is the owner personally
// unblocking someone, not a billing decision.
export async function setUnlimitedOverride(
  companyId: string,
  enabled: boolean
): Promise<{ error?: string }> {
  if (!requireOwner()) return { error: 'Not authorized.' }

  const supabase = createClient()
  const { error } = await supabase
    .from('companies')
    .update({ unlimited_override: enabled })
    .eq('id', companyId)

  if (error) return { error: error.message }
  return {}
}

// Suspend/reactivate/approve any account platform-wide — how the owner
// helps a company lock someone out or lets a pending signup in without
// having to go through that company's own admin.
export async function ownerSetAccountStatus(
  profileId: string,
  authStatus: 'approved' | 'suspended'
): Promise<{ error?: string }> {
  if (!requireOwner()) return { error: 'Not authorized.' }

  const supabase = createClient()
  const { error, count } = await supabase
    .from('profiles')
    .update({ auth_status: authStatus }, { count: 'exact' })
    .eq('id', profileId)

  if (error) return { error: error.message }
  if (!count) return { error: 'User not found.' }
  return {}
}

export async function ownerResetPassword(profileId: string, password: string): Promise<{ error?: string }> {
  if (!requireOwner()) return { error: 'Not authorized.' }
  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' }

  const supabase = createClient()
  const { error, count } = await supabase
    .from('profiles')
    .update({ password_hash: hashPassword(password), auth_status: 'approved' }, { count: 'exact' })
    .eq('id', profileId)

  if (error) return { error: error.message }
  if (!count) return { error: 'User not found.' }
  return {}
}

// Swaps the session cookie to the target account so the owner can see
// exactly what they see, while keeping the owner's own token stashed
// (see lib/auth/session.ts) so stopImpersonation() can restore it.
export async function startImpersonation(
  profileId: string
): Promise<{ error?: string; role?: UserRole; status?: UserStatus }> {
  const owner = requireOwner()
  if (!owner) return { error: 'Not authorized.' }

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, auth_status, language, company_id')
    .eq('id', profileId)
    .maybeSingle()
  if (!profile) return { error: 'User not found.' }

  const ownerToken = getSessionCookieValue()
  if (ownerToken) setImpersonatorCookie(ownerToken)

  const targetUser: SessionUser = {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    role: profile.role,
    status: profile.auth_status,
    language: profile.language ?? 'en',
    company_id: profile.company_id,
  }
  setSessionCookie(targetUser)

  return { role: targetUser.role, status: targetUser.status }
}

export async function stopImpersonation(): Promise<{ error?: string }> {
  const token = getImpersonatorToken()
  if (!token) return { error: 'Not impersonating anyone.' }

  const owner = verifyToken(token)
  clearImpersonatorCookie()
  if (!owner) return { error: 'Owner session expired — please log in again.' }

  setSessionCookie(owner)
  return {}
}
