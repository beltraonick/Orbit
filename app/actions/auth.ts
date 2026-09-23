'use server'

import { redirect } from 'next/navigation'
import { findUserByEmail, createEmployeeWithInvite, findActiveInviteCode, toSessionUser } from '@/lib/auth/store'
import { verifyPassword, hashPassword } from '@/lib/auth/crypto'
import { setSessionCookie, clearSessionCookie, createToken, verifyToken } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import {
  AuthInfrastructureError,
  LOGIN_UNAVAILABLE_MESSAGE,
  REQUEST_UNAVAILABLE_MESSAGE,
  logAuthInfraFailure,
} from '@/lib/auth/infra-error'
import type { Language, SessionUser, UserRole, UserStatus } from '@/lib/auth/types'

// Best-effort — lets the owner panel show when each account last got in,
// and how many times, without ever blocking a login over it. Counts as
// an "access" both for a real login and a silent iOS session restore,
// since the latter also represents someone genuinely opening the app.
async function recordAccess(profileId: string, companyId: string | null): Promise<void> {
  try {
    const supabase = createClient()
    const now = new Date().toISOString()
    await Promise.all([
      supabase.from('profiles').update({ last_login_at: now }).eq('id', profileId),
      supabase.from('login_events').insert({ profile_id: profileId, company_id: companyId }),
    ])
  } catch {
    // never block login over this
  }
}

export async function login(
  email: string,
  password: string,
  locale?: Language
): Promise<{ error?: string; role?: UserRole; status?: UserStatus; token?: string }> {

  if (!email?.trim() || !password) {
    return { error: 'Email and password are required.' }
  }

  // A lookup that FAILED (database down, SUPABASE_SERVICE_ROLE_KEY missing
  // or wrong, ...) must never be reported as bad credentials — that's what
  // made a config problem look like "wrong password" for every user.
  let user
  try {
    user = await findUserByEmail(email.trim())
  } catch (err) {
    if (!(err instanceof AuthInfrastructureError)) logAuthInfraFailure('login.lookup', err)
    return { error: LOGIN_UNAVAILABLE_MESSAGE }
  }

  if (!user) {
    return { error: 'Invalid email or password.' }
  }

  // Account exists but has no password — client not yet activated.
  if (!user.password_hash) {
    return { error: 'Your account has not been activated yet. Use the activation link sent by your administrator.' }
  }

  if (!verifyPassword(password, user.password_hash)) {
    return { error: 'Invalid email or password.' }
  }

  if (user.status === 'suspended') {
    return { error: 'Your account has been suspended. Contact your administrator.' }
  }

  if (user.status === 'pending') {
    return { status: 'pending' }
  }

  // Keep the account's saved language in sync with whatever was picked
  // on the login screen, so it persists everywhere from here on —
  // not just for this one session.
  if (locale && locale !== user.language) {
    user.language = locale
    try {
      const supabase = createClient()
      await supabase.from('profiles').update({ language: locale }).eq('id', user.id)
    } catch {
      // best-effort — the session below still reflects the chosen locale
    }
  }

  await recordAccess(user.id, user.company_id)

  const sessionUser = toSessionUser(user)
  setSessionCookie(sessionUser)

  // Also handed back to the client to keep in localStorage as a fallback —
  // iOS can wipe cookies for home-screen-installed apps when they're fully
  // closed and reopened, even well within the cookie's real expiry. If that
  // happens, the app can silently restore the session from this copy
  // instead of forcing a fresh login. See restoreSession() below.
  const token = createToken(sessionUser)

  return { role: user.role, status: user.status, token }
}

// Re-issues the session cookie from a token the client saved as a backup
// (see login() above). Used when the cookie itself is missing — typically
// because iOS cleared it for a home-screen-installed app — but the client
// still has a valid saved copy.
export async function restoreSession(token: string): Promise<{ error?: string; role?: UserRole; status?: UserStatus }> {
  const user: SessionUser | null = verifyToken(token)
  if (!user) return { error: 'Session expired.' }

  setSessionCookie(user)
  await recordAccess(user.id, user.company_id)
  return { role: user.role, status: user.status }
}

export async function register(data: {
  email: string
  full_name: string
  phone: string | null
  password: string
  confirm_password: string
  language: Language
  invite_code: string
}): Promise<{ error?: string; success?: boolean }> {

  if (!data.email?.trim() || !data.full_name?.trim() || !data.password) {
    return { error: 'Please fill in all required fields.' }
  }

  if (!data.invite_code?.trim()) {
    return { error: 'An invite code is required to register.' }
  }

  if (data.password !== data.confirm_password) {
    return { error: 'Passwords do not match.' }
  }

  if (data.password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }

  // Infrastructure failures below are reported as a temporary system error,
  // never as an invalid invite code or a duplicate email.
  try {
    const invite = await findActiveInviteCode(data.invite_code.trim())
    if (!invite) {
      return { error: 'Invalid or expired invite code. Please ask your administrator for a valid code.' }
    }

    const existing = await findUserByEmail(data.email.trim())
    if (existing) {
      return { error: 'An account with this email already exists.' }
    }

    await createEmployeeWithInvite(
      {
        email: data.email.trim(),
        full_name: data.full_name.trim(),
        phone: data.phone?.trim() || null,
        password_hash: hashPassword(data.password),
        language: data.language,
      },
      invite.company_id,
      invite.id
    )
  } catch (err) {
    if (!(err instanceof AuthInfrastructureError)) logAuthInfraFailure('register', err)
    return { error: REQUEST_UNAVAILABLE_MESSAGE }
  }

  return { success: true }
}

export async function logout(): Promise<void> {
  clearSessionCookie()
  redirect('/login')
}
