import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/auth/session'
import { mintSupabaseAccessToken } from '@/lib/auth/supabase-jwt'

// When a session exists and SUPABASE_JWT_SECRET is configured, every query
// from this client runs as the `authenticated` Postgres role with
// company_id/app_role claims RLS policies check (see migration 040) —
// instead of `anon`, which is what makes tenant isolation actually enforced
// by the database rather than by this app choosing to add .eq('company_id').
// With no session (public pages) or no secret configured yet, this falls
// back to the anon key exactly as before.
export function createClient() {
  const cookieStore = cookies()

  const user = getCurrentUser()
  const accessToken = user ? mintSupabaseAccessToken(user) : null

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
      ...(accessToken ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } } : {}),
    }
  )
}
