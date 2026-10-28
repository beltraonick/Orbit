'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/session'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface MembershipRequest {
  id: string
  profile_id: string
  company_id: string
  status: string
  created_at: string
  profiles: {
    full_name: string
    email: string
    phone: string | null
    role: string
  }
}

export async function getPendingRequests(): Promise<{ requests?: MembershipRequest[]; error?: string }> {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) {
    return { error: 'Not authorized.' }
  }

  const supabase = createClient()
  const { data, error } = await supabase
    .from('membership_requests')
    .select(`
      id, profile_id, company_id, status, created_at,
      profiles!profile_id ( full_name, email, phone, role )
    `)
    .eq('company_id', user.company_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) return { error: error.message }
  return { requests: (data ?? []) as unknown as MembershipRequest[] }
}

export interface RecentMember {
  id: string
  full_name: string
  email: string
  phone: string | null
  created_at: string
}

// How far back the "Recently joined" list on Member Requests looks.
const RECENT_JOIN_DAYS = 7

// People who joined the company recently (e.g. through the invite link,
// which approves them right away so they never show up as a pending
// request). Read-only — just so the admin can see who came in.
export async function getRecentMembers(): Promise<{ members?: RecentMember[]; error?: string }> {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) {
    return { error: 'Not authorized.' }
  }

  const since = new Date(Date.now() - RECENT_JOIN_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const supabase = createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, phone, created_at')
    .eq('company_id', user.company_id)
    .eq('role', 'employee')
    .eq('auth_status', 'approved')
    .eq('status', 'active')
    .gte('created_at', since)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message }
  return { members: (data ?? []) as RecentMember[] }
}

export async function approveMember(requestId: string): Promise<{ error?: string }> {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) {
    return { error: 'Not authorized.' }
  }

  const supabase = createClient()

  // Fetch the request to get profile_id.
  const { data: req } = await supabase
    .from('membership_requests')
    .select('profile_id, company_id')
    .eq('id', requestId)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!req) return { error: 'Request not found.' }

  // Approve: set auth_status='approved' on profile.
  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ auth_status: 'approved' })
    .eq('id', req.profile_id)

  if (profileErr) return { error: profileErr.message }

  // Mark request as approved.
  const { error: requestErr } = await supabase
    .from('membership_requests')
    .update({ status: 'approved', reviewed_by: UUID_RE.test(user.id) ? user.id : null, reviewed_at: new Date().toISOString() })
    .eq('id', requestId)
  if (requestErr) return { error: requestErr.message }

  return {}
}

export async function rejectMember(requestId: string): Promise<{ error?: string }> {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) {
    return { error: 'Not authorized.' }
  }

  const supabase = createClient()

  const { data: req } = await supabase
    .from('membership_requests')
    .select('profile_id, company_id')
    .eq('id', requestId)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!req) return { error: 'Request not found.' }

  // Disassociate the profile from the company (they keep their account).
  const { error: profileErr } = await supabase
    .from('profiles')
    .update({ company_id: null })
    .eq('id', req.profile_id)
    .eq('company_id', user.company_id)
  if (profileErr) return { error: profileErr.message }

  // Mark request as rejected.
  const { error: rejectErr } = await supabase
    .from('membership_requests')
    .update({ status: 'rejected', reviewed_by: UUID_RE.test(user.id) ? user.id : null, reviewed_at: new Date().toISOString() })
    .eq('id', requestId)
  if (rejectErr) return { error: 'Could not reject this request. Please try again.' }

  return {}
}
