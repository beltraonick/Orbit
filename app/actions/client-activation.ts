'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getCurrentUser } from '@/lib/auth/session'
import { generateSecureToken, hashToken, hashPassword } from '@/lib/auth/crypto'

const TOKEN_TTL_HOURS = 72

export async function generateClientActivation(
  profileId: string
): Promise<{ activationUrl?: string; error?: string }> {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) {
    return { error: 'Not authorized.' }
  }

  const supabase = createClient()

  // Confirm the profile belongs to this company and is a client.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, company_id')
    .eq('id', profileId)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!profile || profile.role !== 'client') {
    return { error: 'Client profile not found.' }
  }

  // Invalidate any prior unused tokens for this client.
  await supabase
    .from('client_activations')
    .update({ used_at: new Date().toISOString() })
    .eq('profile_id', profileId)
    .is('used_at', null)

  const token = generateSecureToken()
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString()

  const { error } = await supabase.from('client_activations').insert({
    profile_id: profileId,
    token_hash: hashToken(token),
    expires_at: expiresAt,
  })

  if (error) return { error: error.message }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return { activationUrl: `${baseUrl}/activate?token=${token}` }
}

export async function activateClientAccount(
  token: string,
  password: string,
  confirmPassword: string
): Promise<{ error?: string; success?: boolean }> {
  if (!token?.trim()) return { error: 'Invalid activation link.' }
  if (!password || password.length < 8) return { error: 'Password must be at least 8 characters.' }
  if (password !== confirmPassword) return { error: 'Passwords do not match.' }

  // Runs before any session exists — authorization comes from possessing
  // the one-time token, verified below, not from row-level security.
  const supabase = createServiceRoleClient()
  const tokenHash = hashToken(token.trim())

  const { data: activation } = await supabase
    .from('client_activations')
    .select('id, profile_id, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (!activation) return { error: 'Invalid or expired activation link.' }
  if (activation.used_at) return { error: 'This activation link has already been used.' }
  if (new Date(activation.expires_at) < new Date()) {
    return { error: 'This activation link has expired. Ask your administrator to resend it.' }
  }

  const { error: updateErr } = await supabase
    .from('profiles')
    .update({ password_hash: hashPassword(password), auth_status: 'approved' })
    .eq('id', activation.profile_id)

  if (updateErr) return { error: updateErr.message }

  await supabase
    .from('client_activations')
    .update({ used_at: new Date().toISOString() })
    .eq('id', activation.id)

  return { success: true }
}
