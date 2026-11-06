import 'server-only'
import { cache } from 'react'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getImpersonatorToken, verifyToken } from './session'
import type { SessionUser } from './types'

// The session cookie is a signed token that stays valid for 90 days, so on
// its own it can't notice that someone was removed after they logged in.
// This re-checks the account against the database: an employee who was
// archived, suspended, moved out of the company, deleted their own account,
// or whose role changed is no longer let in with an old token.
//
// Called from the signed-in layouts, from restoreSession() and before a
// browser Supabase token is minted. cache() makes it one lookup per request.
//
// Fails OPEN on a database/config error: an outage must never log every
// user out. Only a successful lookup that says "no longer valid" revokes.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isSessionRevoked = cache(async (user: SessionUser): Promise<boolean> => {
  // The platform owner isn't a company member, and dev seed users have no
  // profile row — neither has anything to re-check.
  if (user.role === 'owner' || !UUID_RE.test(user.id)) return false

  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from('profiles')
      .select('company_id, role, status, auth_status')
      .eq('id', user.id)
      .maybeSingle()
    if (error) return false
    if (!data) return true
    if (data.status === 'archived') return true
    if (data.auth_status === 'suspended') return true
    if (data.company_id !== user.company_id) return true
    if (data.role !== user.role) return true
    return false
  } catch {
    return false
  }
})

// Path that clears the session cookie and goes back to /login.
export const REVOKED_SIGNOUT_PATH = '/api/auth/signed-out'

/**
 * For the signed-in layouts: true when this visit must be signed out.
 * The owner looking at an account through impersonation is left alone
 * (their real, verified owner token is stashed in the impersonator cookie).
 */
export async function mustSignOut(user: SessionUser): Promise<boolean> {
  const impersonator = getImpersonatorToken()
  if (impersonator && verifyToken(impersonator)?.role === 'owner') return false
  return isSessionRevoked(user)
}
