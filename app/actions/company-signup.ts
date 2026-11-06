'use server'

import { trialEndDate } from '@/lib/trial'
import { createServiceRoleClient as createClient } from '@/lib/supabase/service-role'
import { hashPassword, generateInviteCode } from '@/lib/auth/crypto'
import { setSessionCookie } from '@/lib/auth/session'
import { toSessionUser } from '@/lib/auth/store'
import type { AuthUser, Language } from '@/lib/auth/types'
import { REQUEST_UNAVAILABLE_MESSAGE, logAuthInfraFailure } from '@/lib/auth/infra-error'

export async function signupCompany(data: {
  company_name: string
  full_name: string
  email: string
  password: string
  confirm_password: string
  /** Ignored: every new company starts on the 30-day Pro trial and picks a plan later. */
  plan_key?: string
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

  // Database/configuration failures return a generic temporary error (logged
  // server-side) instead of proceeding on a lookup that never actually ran.
  let supabase
  try {
    supabase = createClient()
  } catch (err) {
    logAuthInfraFailure('company_signup', err)
    return { error: REQUEST_UNAVAILABLE_MESSAGE }
  }
  const email = data.email.trim().toLowerCase()

  const { data: existing, error: existingErr } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle()
  if (existingErr) {
    logAuthInfraFailure('company_signup.lookup_email', existingErr)
    return { error: REQUEST_UNAVAILABLE_MESSAGE }
  }
  if (existing) {
    return { error: 'An account with this email already exists.' }
  }

  // Every new company gets 30 days with everything in Pro (lib/trial.ts),
  // no card needed, then picks Crew / Pro / Business on the website.
  const { data: plan, error: planErr } = await supabase.from('plans').select('id').eq('key', 'pro').maybeSingle()
  if (planErr) {
    logAuthInfraFailure('company_signup.lookup_plan', planErr)
    return { error: REQUEST_UNAVAILABLE_MESSAGE }
  }
  const trialEndsAt = trialEndDate()

  const { data: company, error: companyErr } = await supabase
    .from('companies')
    .insert({
      name: data.company_name.trim(),
      language: data.language,
      plan_id: plan?.id ?? null,
      subscription_status: 'trialing',
      trial_ends_at: trialEndsAt,
      billing_email: email,
    })
    .select('id')
    .single()

  if (companyErr || !company) {
    logAuthInfraFailure('company_signup.insert_company', companyErr)
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
    logAuthInfraFailure('company_signup.insert_profile', profileErr)
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
