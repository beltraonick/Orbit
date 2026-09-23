import type { AuthUser, Language, SessionUser, UserRole, UserStatus } from './types'
import { hashPassword, generateId } from './crypto'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { authInfraFailure, logAuthInfraFailure } from './infra-error'

// These lookups run before any session/identity exists (login, invite-code
// registration) — by definition they can't be scoped to a company via RLS,
// since finding out the company IS the point of the lookup. They use the
// service role (bypasses RLS) rather than the anon/authenticated bridge.
const createClient = createServiceRoleClient

const COMPANY_ID = '00000000-0000-0000-0000-000000000001'

const supabaseReady =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('your_')

// ─── Dev fallback accounts ──────────────────────────────────────────
// Used when Supabase isn't configured, or as a safety net if a
// Supabase call fails, so local dev and demos never get locked out.
const SEED_USERS: AuthUser[] = [
  {
    id: 'seed-admin-001',
    email: 'admin@upperconstruction.com',
    full_name: 'Tiago (Admin)',
    phone: null,
    role: 'admin',
    status: 'approved',
    language: 'en',
    password_hash: hashPassword('Admin123!'),
    company_id: COMPANY_ID,
    created_at: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'seed-employee-001',
    email: 'employee@upperconstruction.com',
    full_name: 'Test Employee',
    phone: null,
    role: 'employee',
    status: 'approved',
    language: 'en',
    password_hash: hashPassword('Employee123!'),
    company_id: COMPANY_ID,
    created_at: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'seed-admin-orbit',
    email: 'admin@orbit.test',
    full_name: 'Tiago (Admin)',
    phone: null,
    role: 'admin',
    status: 'approved',
    language: 'en',
    password_hash: hashPassword('Admin123!'),
    company_id: COMPANY_ID,
    created_at: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'seed-employee-orbit',
    email: 'employee@orbit.test',
    full_name: 'Test Employee',
    phone: null,
    role: 'employee',
    status: 'approved',
    language: 'en',
    password_hash: hashPassword('Employee123!'),
    company_id: COMPANY_ID,
    created_at: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'seed-client-orbit',
    email: 'client@orbit.test',
    full_name: 'Client (Demo)',
    phone: null,
    role: 'client',
    status: 'approved',
    language: 'en',
    password_hash: hashPassword('Client123!'),
    company_id: COMPANY_ID,
    created_at: '2024-01-01T00:00:00.000Z',
  },
]

const seedUsers = new Map<string, AuthUser>(SEED_USERS.map(u => [u.id, u]))
const seedEmailIndex = new Map<string, string>(SEED_USERS.map(u => [u.email.toLowerCase(), u.id]))

function findSeedByEmail(email: string): AuthUser | null {
  const id = seedEmailIndex.get(email.toLowerCase())
  return id ? (seedUsers.get(id) ?? null) : null
}

// ─── Supabase-backed profiles ───────────────────────────────────────

interface ProfileAuthRow {
  id: string
  email: string
  full_name: string
  phone: string | null
  role: UserRole
  auth_status: UserStatus
  language: Language | null
  password_hash: string | null
  company_id: string | null
  created_at: string
}

const PROFILE_AUTH_COLUMNS = 'id, email, full_name, phone, role, auth_status, language, password_hash, company_id, created_at'

function rowToAuthUser(row: ProfileAuthRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    phone: row.phone,
    role: row.role,
    status: row.auth_status,
    language: row.language ?? 'en',
    password_hash: row.password_hash ?? '',
    company_id: row.company_id,
    created_at: row.created_at,
  }
}

// Returns null only when the lookup SUCCEEDED and found no such account.
// Any database/configuration failure throws AuthInfrastructureError instead,
// so callers can never mistake an outage for "Invalid email or password."
export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const normalized = email.trim().toLowerCase()

  if (supabaseReady) {
    let result
    try {
      const supabase = createClient()
      result = await supabase
        .from('profiles')
        .select(PROFILE_AUTH_COLUMNS)
        .eq('email', normalized)
        .maybeSingle()
    } catch (err) {
      throw authInfraFailure('profiles.lookup_by_email', err)
    }
    if (result.error) throw authInfraFailure('profiles.lookup_by_email', result.error)
    // Returned even without password_hash so login can give a targeted error.
    if (result.data) return rowToAuthUser(result.data as ProfileAuthRow)
  }

  return findSeedByEmail(normalized)
}

export async function createUser(data: {
  email: string
  full_name: string
  phone: string | null
  password_hash: string
  language: Language
}): Promise<AuthUser> {
  const email = data.email.trim().toLowerCase()

  if (supabaseReady) {
    try {
      const supabase = createClient()
      const { data: row, error } = await supabase
        .from('profiles')
        .insert({
          company_id: COMPANY_ID,
          role: 'employee',
          status: 'active',
          auth_status: 'pending',
          full_name: data.full_name,
          email,
          phone: data.phone,
          password_hash: data.password_hash,
          language: data.language,
        })
        .select(PROFILE_AUTH_COLUMNS)
        .single()
      if (!error && row) return rowToAuthUser(row as ProfileAuthRow)
    } catch {
      // fall through to in-memory
    }
  }

  const user: AuthUser = {
    id: generateId(),
    email,
    full_name: data.full_name,
    phone: data.phone,
    password_hash: data.password_hash,
    language: data.language,
    role: 'employee',
    status: 'pending',
    company_id: COMPANY_ID,
    created_at: new Date().toISOString(),
  }
  seedUsers.set(user.id, user)
  seedEmailIndex.set(email, user.id)
  return user
}

// ─── Invite-code-based employee registration ───────────────────────

export interface InviteCodeRow {
  id: string
  company_id: string
  code: string
  is_active: boolean
}

// Returns null only when the code genuinely doesn't exist / isn't active.
// Database/configuration failures throw AuthInfrastructureError, so they
// aren't reported to the user as "Invalid or expired invite code".
export async function findActiveInviteCode(code: string): Promise<InviteCodeRow | null> {
  if (!supabaseReady) return null
  let result
  try {
    const supabase = createClient()
    result = await supabase
      .from('invite_codes')
      .select('id, company_id, code, is_active')
      .eq('code', code.toUpperCase().trim())
      .eq('is_active', true)
      .maybeSingle()
  } catch (err) {
    throw authInfraFailure('invite_codes.lookup', err)
  }
  if (result.error) throw authInfraFailure('invite_codes.lookup', result.error)
  return result.data ?? null
}

export async function createEmployeeWithInvite(
  data: {
    email: string
    full_name: string
    phone: string | null
    password_hash: string
    language: Language
  },
  company_id: string,
  invite_code_id: string
): Promise<AuthUser> {
  const email = data.email.trim().toLowerCase()

  if (supabaseReady) {
    // A failed insert must surface as a failure — previously it fell through
    // to the in-memory fallback below and reported a registration that was
    // never actually saved.
    let supabase
    let result
    try {
      supabase = createClient()
      result = await supabase
        .from('profiles')
        .insert({
          company_id,
          role: 'employee',
          status: 'active',
          auth_status: 'pending',
          full_name: data.full_name,
          email,
          phone: data.phone,
          password_hash: data.password_hash,
          language: data.language,
        })
        .select(PROFILE_AUTH_COLUMNS)
        .single()
    } catch (err) {
      throw authInfraFailure('profiles.insert_invited_employee', err)
    }
    if (result.error || !result.data) {
      throw authInfraFailure('profiles.insert_invited_employee', result.error)
    }

    const authUser = rowToAuthUser(result.data as ProfileAuthRow)
    // Best-effort, as before: the profile is already saved.
    try {
      const { error: mrErr } = await supabase.from('membership_requests').insert({
        profile_id: authUser.id,
        company_id,
        invite_code_id,
        status: 'pending',
      })
      if (mrErr) logAuthInfraFailure('membership_requests.insert', mrErr)
    } catch (mrErr) {
      logAuthInfraFailure('membership_requests.insert', mrErr)
    }
    return authUser
  }

  // In-memory fallback (no actual membership_request stored)
  const user: AuthUser = {
    id: generateId(),
    email,
    full_name: data.full_name,
    phone: data.phone,
    password_hash: data.password_hash,
    language: data.language,
    role: 'employee',
    status: 'pending',
    company_id,
    created_at: new Date().toISOString(),
  }
  seedUsers.set(user.id, user)
  seedEmailIndex.set(email, user.id)
  return user
}

export function toSessionUser(user: AuthUser): SessionUser {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    status: user.status,
    language: user.language,
    company_id: user.company_id,
  }
}
