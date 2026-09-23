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
  await supabase
    .from('membership_requests')
    .update({ status: 'approved', reviewed_by: UUID_RE.test(user.id) ? user.id : null, reviewed_at: new Date().toISOString() })
    .eq('id', requestId)

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
  await supabase
    .from('profiles')
    .update({ company_id: null })
    .eq('id', req.profile_id)

  // Mark request as rejected.
  const { error: rejectErr } = await supabase
    .from('membership_requests')
    .update({ status: 'rejected', reviewed_by: UUID_RE.test(user.id) ? user.id : null, reviewed_at: new Date().toISOString() })
    .eq('id', requestId)
  if (rejectErr) return { error: 'Could not reject this request. Please try again.' }

  return {}
}
