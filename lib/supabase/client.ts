import { createBrowserClient } from '@supabase/ssr'

// Module-level so the same value is visible to every createClient() call
// across the app without changing any of their call sites. Supabase invokes
// the accessToken callback fresh on every outgoing request (not just once
// at client creation), so updating this via setSupabaseAccessToken() takes
// effect on the very next query — see components/SupabaseAuthBridge.tsx,
// which keeps this refreshed from the server-verified session.
let currentAccessToken: string | null = null

export function setSupabaseAccessToken(token: string | null) {
  currentAccessToken = token
}

// When a valid access token is set, every query from this client runs as
// the `authenticated` Postgres role with company_id/app_role claims RLS
// policies check (see migration 040) — instead of `anon`. With no token
// (logged out, or SUPABASE_JWT_SECRET not configured yet), this falls back
// to the anon key exactly as before.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { accessToken: async () => currentAccessToken }
  )
}
