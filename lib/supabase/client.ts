import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseAccessToken } from '@/app/actions/supabase-token'

// Module-level so the same value is visible to every createClient() call
// across the app without changing any of their call sites. Supabase invokes
// the accessToken callback fresh on every outgoing request (not just once
// at client creation), so updating this via setSupabaseAccessToken() takes
// effect on the very next query — see components/SupabaseAuthBridge.tsx,
// which keeps this refreshed from the server-verified session.
let currentAccessToken: string | null = null
// False until the first token request settles (or a token is set directly).
// Until then a query can't know whether it should run as `authenticated`,
// so it waits for that request instead of racing ahead as `anon`.
let tokenResolved = false
let tokenRequest: Promise<string | null> | null = null

// Bumped on every direct set, so a request that was already in flight when
// the session changed (e.g. logout) can't write its stale token back.
let tokenGeneration = 0

export function setSupabaseAccessToken(token: string | null) {
  currentAccessToken = token
  tokenResolved = true
  tokenGeneration++
  tokenRequest = null
}

// Fetches a fresh token from the server session and stores it. Concurrent
// callers share the one in-flight request.
export function refreshSupabaseAccessToken(): Promise<string | null> {
  if (!tokenRequest) {
    const generation = tokenGeneration
    const request: Promise<string | null> = getSupabaseAccessToken()
      .catch(() => null)
      .then(token => {
        if (generation === tokenGeneration) {
          currentAccessToken = token
          tokenResolved = true
        }
        return currentAccessToken
      })
      .finally(() => { if (tokenRequest === request) tokenRequest = null })
    tokenRequest = request
  }
  return tokenRequest
}

// When a valid access token is set, every query from this client runs as
// the `authenticated` Postgres role with company_id/app_role claims RLS
// policies check (see migration 040) — instead of `anon`. With no token
// (logged out, or SUPABASE_JWT_SECRET not configured yet), this falls back
// to the anon key exactly as before.
//
// On a full page load, a page's first queries can fire before
// SupabaseAuthBridge's first refresh has come back. Those used to go out as
// `anon`, which migration 044 no longer lets read anything — so e.g. opening
// a project detail page returned no row and showed "Project not found".
// Waiting for the first token here closes that race for every page.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => {
        if (!tokenResolved) await refreshSupabaseAccessToken()
        return currentAccessToken
      },
    }
  )
}
