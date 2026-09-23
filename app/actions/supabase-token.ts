'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { mintSupabaseAccessToken } from '@/lib/auth/supabase-jwt'

// Called by the browser (see lib/supabase/client.ts) to get a short-lived
// token it can hand to Supabase so its own direct queries also run as the
// `authenticated` Postgres role, company-scoped by RLS — instead of `anon`.
// This is safe to expose to the client: the claims inside (company_id,
// app_role) are the same information already visible to the logged-in user
// through the app itself, and the token expires in 15 minutes.
export async function getSupabaseAccessToken(): Promise<string | null> {
  const user = getCurrentUser()
  if (!user) return null
  return mintSupabaseAccessToken(user)
}
