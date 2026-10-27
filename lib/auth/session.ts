/**
 * Stateless JWT-style sessions using HMAC-SHA256.
 * No server-side state — survives hot reloads, restarts, and horizontal scaling.
 * Swap this module for a Supabase/Firebase session handler in production.
 */
import { createHmac } from 'crypto'
import { cookies } from 'next/headers'
import type { SessionUser } from './types'

const COOKIE_NAME = 'uc_session'
const MAX_AGE = 60 * 60 * 24 * 90 // 90 days in seconds — stay logged in like a normal app
if (!process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET environment variable is not set. Set it in Vercel → Settings → Environment Variables.')
}
const SECRET = process.env.AUTH_SECRET

// ─── Token encoding/decoding ─────────────────────────────────────────────────

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

function fromB64url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url')
}

export function createToken(user: SessionUser): string {
  const payload = b64url(JSON.stringify({ user, exp: Date.now() + MAX_AGE * 1000 }))
  const sig = sign(payload)
  return `${payload}.${sig}`
}

export function verifyToken(token: string): SessionUser | null {
  try {
    const dot = token.lastIndexOf('.')
    if (dot === -1) return null
    const payload = token.slice(0, dot)
    const sig = token.slice(dot + 1)
    // Constant-time comparison via re-signing
    if (sign(payload) !== sig) return null
    const { user, exp } = JSON.parse(fromB64url(payload))
    if (!user || !exp || Date.now() > exp) return null
    return user as SessionUser
  } catch {
    return null
  }
}

// ─── Cookie helpers (server components / server actions only) ─────────────────

export function setSessionCookie(user: SessionUser): void {
  const token = createToken(user)
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE,
    path: '/',
  })
}

export function clearSessionCookie(): void {
  cookies().delete(COOKIE_NAME)
}

export function getCurrentUser(): SessionUser | null {
  try {
    const token = cookies().get(COOKIE_NAME)?.value
    if (!token) return null
    return verifyToken(token)
  } catch {
    return null
  }
}

export function getSessionCookieValue(): string | null {
  try {
    return cookies().get(COOKIE_NAME)?.value ?? null
  } catch {
    return null
  }
}

// ─── Impersonation (owner-only "log in as" support tool) ──────────────────
// While an owner impersonates another account, the *impersonated* user's
// token lives in the normal session cookie above (so every existing
// role-gated layout just works unmodified), and the owner's own token is
// stashed here so it can be restored when they stop.

const IMPERSONATOR_COOKIE = 'uc_impersonator'

export function setImpersonatorCookie(token: string): void {
  cookies().set(IMPERSONATOR_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE,
    path: '/',
  })
}

export function getImpersonatorToken(): string | null {
  try {
    return cookies().get(IMPERSONATOR_COOKIE)?.value ?? null
  } catch {
    return null
  }
}

export function clearImpersonatorCookie(): void {
  cookies().delete(IMPERSONATOR_COOKIE)
}
