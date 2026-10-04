'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { haversineDistance } from '@/lib/clock-window'

// Logs a timestamped "still working" confirmation for an open time entry,
// with the employee's current location checked against job sites if
// geofencing is set up — so a yes isn't just an unverifiable tap, there's a
// record of where they said it from. Does not block the confirmation if
// they're outside every site (that's a judgment call for the admin
// reviewing it later), it just records the fact honestly.
export async function confirmStillWorking(data: {
  entryId: string
  latitude?: number
  longitude?: number
}) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', user.email)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!profile) return { error: 'Profile not found' }

  const { data: entry } = await supabase
    .from('time_entries')
    .select('id, employee_id, company_id')
    .eq('id', data.entryId)
    .eq('employee_id', profile.id)
    .is('clock_out', null)
    .maybeSingle()

  if (!entry) return { error: 'Entry not found or already closed' }

  let withinJobSite: boolean | null = null
  let jobSiteName: string | null = null
  if (data.latitude != null && data.longitude != null) {
    const { data: jobSites } = await supabase
      .from('job_sites')
      .select('name, latitude, longitude, radius_meters')
      .eq('company_id', user.company_id)
      .eq('active', true)
    const match = (jobSites ?? []).find(
      (s: { latitude: number; longitude: number; radius_meters: number }) =>
        haversineDistance(data.latitude!, data.longitude!, s.latitude, s.longitude) <= s.radius_meters
    )
    withinJobSite = (jobSites ?? []).length > 0 ? !!match : null
    jobSiteName = match?.name ?? null
  }

  const { error } = await supabase.from('overtime_confirmations').insert({
    company_id: user.company_id,
    employee_id: profile.id,
    time_entry_id: entry.id,
    latitude: data.latitude ?? null,
    longitude: data.longitude ?? null,
    within_job_site: withinJobSite,
    job_site_name: jobSiteName,
  })

  if (error) return { error: error.message }
  return { ok: true }
}
