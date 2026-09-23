import 'server-only'
/**
 * Bridges this app's own custom session (lib/auth/session.ts — an
 * HMAC-signed token, not a real JWT, verified against AUTH_SECRET) to a
 * real, standards-compliant JWT that Supabase's PostgREST layer will accept
 * and use to run queries as the `authenticated` Postgres role instead of
 * `anon` — carrying company_id/app_role as claims RLS policies can read
 * directly, with no join back to `profiles` and no auth.users row needed.
 *
 * This requires SUPABASE_JWT_SECRET to be set to this Supabase project's
 * actual JWT secret (Dashboard -> Project Settings -> API -> JWT Settings
 * -> "Legacy JWT Secret"). Until that's set, mintSupabaseAccessToken()
 * returns null and every Supabase call silently continues to run as `anon`
 * — exactly today's behavior — so this file is safe to deploy before the
 * secret is configured, but tenant isolation does NOT take effect until it
 * is (see migration 044's comment header).
 */
import { createHmac } from 'crypto'
import type { SessionUser } from './types'

const ACCESS_TOKEN_TTL_SECONDS = 60 * 15 // short-lived: bounds how stale a
  // claim (company_id/role) can be if it's ever changed for someone, without
  // needing an explicit revocation mechanism — the client just re-mints
  // from the current session on every refresh.

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/**
 * Returns a JWT Supabase will verify and use to set request.jwt.claims,
 * or null if SUPABASE_JWT_SECRET isn't configured (caller should treat this
 * as "fall back to anon" rather than erroring — see file header).
 */
export function mintSupabaseAccessToken(user: SessionUser): string | null {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) return null

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    // `sub` and `role` are the two claims PostgREST itself understands:
    // `role: authenticated` is what makes it run the query as the
    // `authenticated` Postgres role instead of `anon`.
    sub: user.id,
    role: 'authenticated',
    // Custom claims our RLS policies read directly — see
    // migration 040's orbit_jwt_company_id()/orbit_jwt_app_role() helpers.
    app_company_id: user.company_id,
    app_role: user.role,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
  }

  const headerPart = b64url(JSON.stringify(header))
  const payloadPart = b64url(JSON.stringify(payload))
  const signingInput = `${headerPart}.${payloadPart}`
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url')

  return `${signingInput}.${signature}`
}
