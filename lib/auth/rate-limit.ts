import 'server-only'
import { headers } from 'next/headers'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

// Login throttling: after too many wrong passwords in a short window, login
// is refused for a while — per email (someone guessing one account's
// password) and per IP (someone trying many accounts). Failed attempts are
// stored in login_attempts (migration 054), which only the service role can
// touch.
//
// Fails OPEN: if the table doesn't exist yet (migration not run) or the
// database errors, login works exactly as before, just without the limit.

const WINDOW_MS = 15 * 60 * 1000
const MAX_PER_EMAIL = 8
const MAX_PER_IP = 30

export const LOGIN_RATE_LIMITED_MESSAGE =
  'Too many failed attempts. Please wait 15 minutes and try again, or reset your password.'

function clientIp(): string | null {
  try {
    const h = headers()
    return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null
  } catch {
    return null
  }
}

export async function isLoginRateLimited(email: string): Promise<boolean> {
  try {
    const supabase = createServiceRoleClient()
    const since = new Date(Date.now() - WINDOW_MS).toISOString()
    const ip = clientIp()
    const [byEmail, byIp] = await Promise.all([
      supabase.from('login_attempts').select('id', { count: 'exact', head: true }).eq('email', email).gte('attempted_at', since),
      ip
        ? supabase.from('login_attempts').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('attempted_at', since)
        : Promise.resolve({ count: 0, error: null }),
    ])
    if (byEmail.error || byIp.error) return false
    return (byEmail.count ?? 0) >= MAX_PER_EMAIL || (byIp.count ?? 0) >= MAX_PER_IP
  } catch {
    return false
  }
}

export async function recordFailedLogin(email: string): Promise<void> {
  try {
    const supabase = createServiceRoleClient()
    await supabase.from('login_attempts').insert({ email, ip: clientIp() })
  } catch {
    // best-effort
  }
}

export async function clearFailedLogins(email: string): Promise<void> {
  try {
    const supabase = createServiceRoleClient()
    await supabase.from('login_attempts').delete().eq('email', email)
  } catch {
    // best-effort
  }
}
