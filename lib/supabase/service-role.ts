import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// SERVER-ONLY. Never import this from a 'use client' file or anything that
// could end up in a browser bundle — SUPABASE_SERVICE_ROLE_KEY bypasses RLS
// entirely. The `server-only` import above makes the build fail if that
// ever happens.
//
// This exists for the narrow set of operations that genuinely cannot be
// scoped to a company by row-level security, because they run BEFORE any
// identity exists yet:
//   - login (looking a person up by email, before we know who they are)
//   - registration / invite-code acceptance (creating a profile in
//     whatever company the invite code belongs to)
//   - company signup (creating a brand new company + its first admin)
//   - password reset / client activation completion (a not-yet-logged-in
//     person redeeming a one-time token)
//   - owner/platform-admin actions (legitimately cross-company by design)
//
// Every call site using this client MUST do its own authorization check in
// code (e.g. verifying a password hash, a one-time token, or
// getCurrentUser().role === 'owner') before touching data, since the
// database will not do it for these queries.

export class ServiceRoleConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceRoleConfigError'
  }
}

// Catches the two easy-to-make configuration mistakes that would otherwise
// only show up later as confusing query failures: pasting the anon key
// instead of the service_role key, and pasting a key from a different
// Supabase project than NEXT_PUBLIC_SUPABASE_URL points at. Only non-secret
// JWT claims (`role`, `ref`) are read; the key itself is never logged or
// included in an error message.
function checkServiceRoleKey(url: string, key: string): string | null {
  if (key.startsWith('sb_publishable_')) {
    return 'SUPABASE_SERVICE_ROLE_KEY holds a publishable (public) key, not the secret service-role key.'
  }
  if (key.startsWith('sb_secret_')) return null // new-format secret key: no claims to inspect

  const parts = key.split('.')
  if (parts.length !== 3) return 'SUPABASE_SERVICE_ROLE_KEY is not a recognizable Supabase key.'

  let claims: { role?: unknown; ref?: unknown }
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return 'SUPABASE_SERVICE_ROLE_KEY is not a recognizable Supabase key.'
  }

  if (claims.role !== 'service_role') {
    return `SUPABASE_SERVICE_ROLE_KEY has role "${String(claims.role)}", expected "service_role" (is it the anon key?).`
  }

  let host = ''
  try { host = new URL(url).hostname } catch { /* checked by caller */ }
  if (host.endsWith('.supabase.co') && typeof claims.ref === 'string') {
    const urlRef = host.split('.')[0]
    if (claims.ref !== urlRef) {
      return `SUPABASE_SERVICE_ROLE_KEY belongs to Supabase project "${claims.ref}", but NEXT_PUBLIC_SUPABASE_URL points at project "${urlRef}".`
    }
  }
  return null
}

let validatedKey: string | null = null

export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) {
    throw new ServiceRoleConfigError('NEXT_PUBLIC_SUPABASE_URL is not set.')
  }
  if (!key) {
    throw new ServiceRoleConfigError(
      'SUPABASE_SERVICE_ROLE_KEY is not set. This is required for login, signup, invite acceptance, password reset, and owner actions. Find it in Supabase Dashboard -> Project Settings -> API -> service_role secret.'
    )
  }
  if (validatedKey !== key) {
    const problem = checkServiceRoleKey(url, key)
    if (problem) throw new ServiceRoleConfigError(problem)
    validatedKey = key
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
