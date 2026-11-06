'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/session'
import { setSessionCookie, clearSessionCookie, getImpersonatorToken } from '@/lib/auth/session'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { hashPassword, verifyPassword } from '@/lib/auth/crypto'
import { toSessionUser } from '@/lib/auth/store'
import type { AuthUser, Language } from '@/lib/auth/types'

export async function getMyProfile() {
  const user = getCurrentUser()
  if (!user) return null

  const supabase = createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, avatar_url, language, email_notifications, role')
    .eq('id', user.id)
    .maybeSingle()

  return data
}

export async function updateProfile(data: {
  full_name: string
  phone: string | null
  avatar_url: string | null
  language: Language
  email_notifications: boolean
}): Promise<{ error?: string }> {
  const user = getCurrentUser()
  if (!user) return { error: 'Not authorized.' }
  if (!data.full_name.trim()) return { error: 'Name is required.' }

  const supabase = createClient()
  const { data: updated, error } = await supabase
    .from('profiles')
    .update({
      full_name: data.full_name.trim(),
      phone: data.phone || null,
      avatar_url: data.avatar_url || null,
      language: data.language,
      email_notifications: data.email_notifications,
    })
    .eq('id', user.id)
    .select('id, email, full_name, phone, role, auth_status, language, password_hash, company_id, created_at')
    .single()

  if (error || !updated) return { error: 'Could not save changes.' }

  // Refresh the session cookie so the new name/language show up immediately.
  const authUser: AuthUser = {
    id: updated.id,
    email: updated.email,
    full_name: updated.full_name,
    phone: updated.phone,
    role: updated.role,
    status: updated.auth_status,
    language: updated.language ?? data.language,
    password_hash: updated.password_hash ?? '',
    company_id: updated.company_id,
    created_at: updated.created_at,
  }
  setSessionCookie(toSessionUser(authUser))

  return {}
}

// "Delete my account" (required by the App Store for apps that let people
// sign up). The login is removed for good: email, phone, photo and password
// are wiped and the account is closed, so it can't sign in again and the
// open session is signed out (lib/auth/revocation.ts). The name stays on the
// company's own work records (hours, pay) that it has to keep.
export async function deleteMyAccount(password: string): Promise<{ error?: string }> {
  const user = getCurrentUser()
  if (!user || user.role === 'owner') return { error: 'Not authorized.' }
  // The owner viewing someone's account must never delete it.
  if (getImpersonatorToken()) return { error: 'Not authorized.' }
  if (!password) return { error: 'wrongPassword' }

  let supabase
  try {
    supabase = createServiceRoleClient()
  } catch {
    return { error: 'failed' }
  }

  const { data: profile, error: readErr } = await supabase
    .from('profiles')
    .select('id, password_hash')
    .eq('id', user.id)
    .maybeSingle()
  if (readErr || !profile) return { error: 'failed' }
  if (!profile.password_hash || !verifyPassword(password, profile.password_hash)) {
    return { error: 'wrongPassword' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      email: `deleted-${user.id}@deleted.invalid`,
      phone: null,
      avatar_url: null,
      password_hash: null,
      email_notifications: false,
      status: 'archived',
      auth_status: 'suspended',
    })
    .eq('id', user.id)
  if (error) return { error: 'failed' }

  clearSessionCookie()
  return {}
}

export async function changeMyPassword(data: {
  current_password: string
  new_password: string
  confirm_password: string
}): Promise<{ error?: string }> {
  const user = getCurrentUser()
  if (!user) return { error: 'Not authorized.' }

  if (data.new_password !== data.confirm_password) {
    return { error: 'New passwords do not match.' }
  }
  if (data.new_password.length < 8) {
    return { error: 'New password must be at least 8 characters.' }
  }

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('profiles')
    .select('password_hash')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.password_hash || !verifyPassword(data.current_password, profile.password_hash)) {
    return { error: 'Current password is incorrect.' }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ password_hash: hashPassword(data.new_password) })
    .eq('id', user.id)

  if (error) return { error: 'Could not change password.' }
  return {}
}
