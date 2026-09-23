import type { AuthUser, Language, SessionUser, UserRole, UserStatus } from './types'
import { hashPassword, generateId } from './crypto'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

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

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const normalized = email.trim().toLowerCase()

  if (supabaseReady) {
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from('profiles')
        .select(PROFILE_AUTH_COLUMNS)
        .eq('email', normalized)
        .maybeSingle()
      if (data?.password_hash) return rowToAuthUser(data as ProfileAuthRow)
      // Return user without password_hash so login can give a targeted error.
      if (data) return rowToAuthUser(data as ProfileAuthRow)
    } catch {
      // Supabase unreachable/misconfigured — fall through to seed accounts
    }
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

export async function findActiveInviteCode(code: string): Promise<InviteCodeRow | null> {
  if (!supabaseReady) return null
  try {
    const supabase = createClient()
    const { data } = await supabase
      .from('invite_codes')
      .select('id, company_id, code, is_active')
      .eq('code', code.toUpperCase().trim())
      .eq('is_active', true)
      .maybeSingle()
    return data ?? null
  } catch {
    return null
  }
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
    try {
      const supabase = createClient()
      const { data: row, error } = await supabase
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

      if (!error && row) {
        const authUser = rowToAuthUser(row as ProfileAuthRow)
        // Separate try so a missing membership_requests table doesn't
        // swallow the successful profile insert and fall to in-memory.
        try {
          await supabase.from('membership_requests').insert({
            profile_id: authUser.id,
            company_id,
            invite_code_id,
            status: 'pending',
          })
        } catch (mrErr) {
          console.error('[register] membership_requests insert failed:', mrErr)
        }
        return authUser
      }
    } catch {
      // fall through to in-memory
    }
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
