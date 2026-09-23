import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// SERVER-ONLY. Never import this from a 'use client' file or anything that
// could end up in a browser bundle — SUPABASE_SERVICE_ROLE_KEY bypasses RLS
// entirely.
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
export function createServiceRoleClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. This is required for login, signup, invite acceptance, password reset, and owner actions to work once RLS restricts the anon key. Find it in Supabase Dashboard -> Project Settings -> API -> service_role secret.'
    )
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
