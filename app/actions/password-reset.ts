'use server'

import { createServiceRoleClient as createClient } from '@/lib/supabase/service-role'
import { generateSecureToken, hashToken, hashPassword } from '@/lib/auth/crypto'
import { REQUEST_UNAVAILABLE_MESSAGE, logAuthInfraFailure } from '@/lib/auth/infra-error'

// Both flows here run before any session exists — a not-yet-logged-in
// person requesting or redeeming a reset link. Authorization comes entirely
// from possessing the one-time token (verified in code below), not from
// row-level security, so this uses the service role rather than the
// anon/authenticated bridge.
//
// Database/configuration failures return a generic temporary error (and are
// logged server-side) — never "invalid link", and never the silent
// "if the account exists…" success response.

const TOKEN_TTL_HOURS = 1

// Reset links are delivered by email only. They are NEVER returned to the
// browser that asked for them: whoever typed an email address would otherwise
// get a working link for that account (account takeover). When email is not
// configured (RESEND_API_KEY), no token is created and the person is told to
// ask their company admin, who can set a new password under Employees.
function emailDeliveryConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export async function requestPasswordReset(
  email: string
): Promise<{ error?: string; delivery?: 'email' | 'admin' }> {
  if (!email?.trim()) return { error: 'Email is required.' }

  // The answer depends only on configuration, never on whether the account
  // exists, so it can't be used to discover which emails are registered.
  if (!emailDeliveryConfigured()) return { delivery: 'admin' }

  let supabase
  try {
    supabase = createClient()
  } catch (err) {
    logAuthInfraFailure('password_reset.request', err)
    return { error: REQUEST_UNAVAILABLE_MESSAGE }
  }
  const normalized = email.trim().toLowerCase()

  const { data: profile, error: lookupErr } = await supabase
    .from('profiles')
    .select('id, auth_status, password_hash')
    .eq('email', normalized)
    .maybeSingle()

  if (lookupErr) {
    logAuthInfraFailure('password_reset.lookup_profile', lookupErr)
    return { error: REQUEST_UNAVAILABLE_MESSAGE }
  }

  // Don't reveal whether the account exists — always return the same result.
  if (!profile || !profile.password_hash || profile.auth_status !== 'approved') {
    return { delivery: 'email' }
  }

  // Invalidate prior unused reset tokens.
  await supabase
    .from('password_resets')
    .update({ used_at: new Date().toISOString() })
    .eq('profile_id', profile.id)
    .is('used_at', null)

  const token = generateSecureToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString()

  const { error } = await supabase.from('password_resets').insert({
    profile_id: profile.id,
    token_hash: hashToken(token),
    expires_at: expiresAt,
  })

  if (error) {
    logAuthInfraFailure('password_reset.insert_token', error)
    return { error: REQUEST_UNAVAILABLE_MESSAGE }
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const resetUrl = `${baseUrl}/reset-password?token=${token}`
  try {
    const { Resend } = await import('resend')
    const { error: sendErr } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.PASSWORD_RESET_FROM ?? 'OrbitOps <onboarding@resend.dev>',
      to: normalized,
      subject: 'Reset your OrbitOps password',
      text: `Use this link to choose a new password (valid for ${TOKEN_TTL_HOURS} hour):\n\n${resetUrl}\n\nIf you didn't ask for this, you can ignore this email.`,
    })
    if (sendErr) throw new Error(sendErr.message)
  } catch (err) {
    logAuthInfraFailure('password_reset.send_email', err)
    return { error: REQUEST_UNAVAILABLE_MESSAGE }
  }
  return { delivery: 'email' }
}

export async function resetPassword(
  token: string,
  password: string,
  confirmPassword: string
): Promise<{ error?: string; success?: boolean }> {
  if (!token?.trim()) return { error: 'Invalid reset link.' }
  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' }
  if (password !== confirmPassword) return { error: 'Passwords do not match.' }

  let supabase
  try {
    supabase = createClient()
  } catch (err) {
    logAuthInfraFailure('password_reset.redeem', err)
    return { error: REQUEST_UNAVAILABLE_MESSAGE }
  }
  const tokenHash = hashToken(token.trim())

  const { data: reset, error: lookupErr } = await supabase
    .from('password_resets')
    .select('id, profile_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (lookupErr) {
    logAuthInfraFailure('password_reset.lookup_token', lookupErr)
    return { error: REQUEST_UNAVAILABLE_MESSAGE }
  }
  if (!reset) return { error: 'Invalid or expired reset link.' }
  if (reset.used_at) return { error: 'This reset link has already been used.' }
  if (new Date(reset.expires_at) < new Date()) {
    return { error: 'This reset link has expired. Please request a new one.' }
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ password_hash: hashPassword(password) })
    .eq('id', reset.profile_id)

  if (updateErr) {
    logAuthInfraFailure('password_reset.update_password', updateErr)
    return { error: REQUEST_UNAVAILABLE_MESSAGE }
  }

  const { error: markErr } = await supabase
    .from('password_resets')
    .update({ used_at: new Date().toISOString() })
    .eq('id', reset.id)
  if (markErr) logAuthInfraFailure('password_reset.mark_used', markErr)

  return { success: true }
}
