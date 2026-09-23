'use server'

import { createServiceRoleClient as createClient } from '@/lib/supabase/service-role'
import { hashPassword, generateInviteCode } from '@/lib/auth/crypto'
import { setSessionCookie } from '@/lib/auth/session'
import { toSessionUser } from '@/lib/auth/store'
import type { AuthUser, Language } from '@/lib/auth/types'

export async function signupCompany(data: {
  company_name: string
  full_name: string
  email: string
  password: string
  confirm_password: string
  plan_key: 'free' | 'starter' | 'growth'
  language: Language
}): Promise<{ error?: string }> {
  if (!data.company_name.trim() || !data.full_name.trim() || !data.email.trim()) {
    return { error: 'Please fill in all required fields.' }
  }
  if (data.password !== data.confirm_password) {
    return { error: 'Passwords do not match.' }
  }
  if (data.password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }

  const supabase = createClient()
  const email = data.email.trim().toLowerCase()

  const { data: existing } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle()
  if (existing) {
    return { error: 'An account with this email already exists.' }
  }

  const { data: plan } = await supabase.from('plans').select('id').eq('key', data.plan_key).maybeSingle()

  // Free needs no payment, so there's nothing to "trial" — it's active
  // from day one. Paid plans start a real 14-day trial with a real end
  // date, instead of sitting in an indefinite "trialing" limbo that only
  // the owner can ever resolve by hand.
  const isFree = data.plan_key === 'free'
  const trialEndsAt = isFree ? null : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()

  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .insert({
      name: data.company_name.trim(),
      language: data.language,
      plan_id: plan?.id ?? null,
      subscription_status: isFree ? 'active' : 'trialing',
      trial_ends_at: trialEndsAt,
      billing_email: email,
    })
    .select('id')
    .single()

  if (companyErr || !company) {
    return { error: 'Could not create your company. Please try again.' }
  }

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .insert({
      company_id: company.id,
      role: 'admin',
      full_name: data.full_name.trim(),
      email,
      status: 'active',
      auth_status: 'approved',
      password_hash: hashPassword(data.password),
      language: data.language,
    })
    .select('id, email, full_name, phone, role, auth_status, language, password_hash, company_id, created_at')
    .single()

  if (profileErr || !profile) {
    // Roll back the orphaned company so a retry doesn't pile up dead rows.
    await supabase.from('companies').delete().eq('id', company.id)
    return { error: 'Could not create your account. Please try again.' }
  }

  // Auto-generate the first invite code for this company so the admin
  // can immediately share it with employees to register.
  let inviteAttempts = 0
  while (inviteAttempts < 5) {
    const code = generateInviteCode()
    const { error: codeErr } = await supabase.from('invite_codes').insert({
      company_id: company.id,
      code,
      created_by: profile.id,
      is_active: true,
    })
    if (!codeErr) break
    inviteAttempts++
  }

  const authUser: AuthUser = {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    phone: profile.phone,
    role: profile.role,
    status: profile.auth_status,
    language: profile.language ?? data.language,
    password_hash: profile.password_hash ?? '',
    company_id: profile.company_id,
    created_at: profile.created_at,
  }

  setSessionCookie(toSessionUser(authUser))
  return {}
}
