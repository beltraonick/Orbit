'use client'

import { useEffect } from 'react'
import { getSupabaseAccessToken } from '@/app/actions/supabase-token'
import { setSupabaseAccessToken } from '@/lib/supabase/client'

// Mounted once per authenticated layout (admin/employee/client/owner).
// Keeps the browser's Supabase client carrying a fresh, short-lived token
// minted from the server-verified session, so its own direct queries run as
// the `authenticated` Postgres role — company-scoped by RLS — instead of
// `anon`. Renders nothing.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000 // well under the token's 15-minute expiry

export function SupabaseAuthBridge() {
  useEffect(() => {
    let cancelled = false

    async function refresh() {
      const token = await getSupabaseAccessToken()
      if (!cancelled) setSupabaseAccessToken(token)
    }

    refresh()
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
      setSupabaseAccessToken(null)
    }
  }, [])

  return null
}
