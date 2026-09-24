'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { hasPermission, type EmployeePermissions } from '@/lib/permissions'
import { revalidatePath } from 'next/cache'


// ─── Worker CRUD (admin only) ─────────────────────────────────────────────────

export async function createWorker(data: {
  full_name: string
  pay_mode: 'daily' | 'hourly'
  daily_rate?: number | null
  hourly_rate?: number | null
  position?: string
  project_ids: string[]
}) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()

  const { data: worker, error } = await supabase
    .from('workers')
    .insert({
      company_id: user.company_id,
      full_name: data.full_name.trim(),
      daily_rate: data.pay_mode === 'daily' ? (data.daily_rate ?? 0) : null,
      hourly_rate: data.pay_mode === 'hourly' ? (data.hourly_rate ?? 0) : null,
      position: data.position?.trim() || null,
    })
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  if (!worker) return { error: 'Failed to create worker' }

  if (data.project_ids.length > 0) {
    const { error: wpErr } = await supabase.from('worker_projects').insert(
      data.project_ids.map(pid => ({
        worker_id: worker.id,
        project_id: pid,
        company_id: user.company_id,
      }))
    )
    if (wpErr) {
      revalidatePath('/admin/employees')
      return { error: 'Worker saved, but project access could not be saved. Please edit the worker and try again.' }
    }
  }

  revalidatePath('/admin/employees')
  return { ok: true, id: worker.id }
}

export async function updateWorker(
  workerId: string,
  data: {
    full_name?: string
    pay_mode?: 'daily' | 'hourly'
    daily_rate?: number | null
    hourly_rate?: number | null
    position?: string
    status?: string
    project_ids?: string[]
  }
) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()

  const payload: Record<string, unknown> = {}
  if (data.full_name !== undefined) payload.full_name = data.full_name.trim()
  if (data.pay_mode === 'daily') {
    payload.daily_rate = data.daily_rate ?? 0
    payload.hourly_rate = null
  } else if (data.pay_mode === 'hourly') {
    payload.hourly_rate = data.hourly_rate ?? 0
    payload.daily_rate = null
  } else {
    // Legacy path: only rate provided without mode
    if (data.daily_rate !== undefined) payload.daily_rate = data.daily_rate
    if (data.hourly_rate !== undefined) payload.hourly_rate = data.hourly_rate
  }
  if (data.position !== undefined) payload.position = data.position?.trim() || null
  if (data.status !== undefined) payload.status = data.status

  if (Object.keys(payload).length > 0) {
    const { error } = await supabase
      .from('workers')
      .update(payload)
      .eq('id', workerId)
      .eq('company_id', user.company_id)
    if (error) return { error: error.message }
  }

  if (data.project_ids !== undefined) {
    const { error: delErr } = await supabase.from('worker_projects').delete().eq('worker_id', workerId).eq('company_id', user.company_id)
    const { error: insErr } = !delErr && data.project_ids.length > 0
      ? await supabase.from('worker_projects').insert(
          data.project_ids.map(pid => ({
            worker_id: workerId,
            project_id: pid,
            company_id: user.company_id,
          }))
        )
      : { error: null }
    if (delErr || insErr) {
      revalidatePath('/admin/employees')
      return { error: 'Worker saved, but project access could not be updated. Please try again.' }
    }
  }

  revalidatePath('/admin/employees')
  return { ok: true }
}

// ─── Supervisor: clock team member in/out ─────────────────────────────────────

export async function supervisorClockIn(data: {
  projectId?: string     // omit for a general (not project-scoped) clock-in
  profileId?: string    // if clocking in a profile-employee
  workerId?: string     // if clocking in a no-account worker
  notes?: string
}) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, permissions')
    .eq('email', user.email)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!profile) return { error: 'Profile not found' }

  const isSupervisor = user.role === 'admin' || hasPermission(profile.permissions as EmployeePermissions | null, 'supervisor')
  const canCheckinTeam = hasPermission(profile.permissions as EmployeePermissions | null, 'checkin_team')

  if (!isSupervisor && !canCheckinTeam) return { error: 'Not authorized' }

  if (!data.profileId && !data.workerId) return { error: 'Must provide profileId or workerId' }

  // Check nobody is already clocked in for this person anywhere in the
  // company — one person can't be on the clock for two projects (or two
  // general shifts) at once.
  const existing = data.profileId
    ? await supabase
        .from('time_entries')
        .select('id')
        .eq('employee_id', data.profileId)
        .eq('company_id', user.company_id)
        .is('clock_out', null)
        .maybeSingle()
    : await supabase
        .from('time_entries')
        .select('id')
        .eq('worker_id', data.workerId!)
        .eq('company_id', user.company_id)
        .is('clock_out', null)
        .maybeSingle()

  if (existing.data) return { error: 'Already clocked in' }

  const { data: entry, error } = await supabase
    .from('time_entries')
    .insert({
      company_id: user.company_id,
      project_id: data.projectId ?? null,
      employee_id: data.profileId ?? null,
      worker_id: data.workerId ?? null,
      clock_in: new Date().toISOString(),
      clocked_by_profile_id: profile.id,
      is_manual_entry: false,
      notes: data.notes?.trim() || null,
      approval_status: 'approved',
    })
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  return { ok: true, entryId: entry?.id }
}

export async function supervisorClockOut(data: {
  entryId: string
  isFullDay: boolean
  notes?: string
}) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, permissions')
    .eq('email', user.email)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!profile) return { error: 'Profile not found' }

  const isSupervisor = user.role === 'admin' || hasPermission(profile.permissions as EmployeePermissions | null, 'supervisor')
  const canCheckinTeam = hasPermission(profile.permissions as EmployeePermissions | null, 'checkin_team')

  if (!isSupervisor && !canCheckinTeam) return { error: 'Not authorized' }

  const { error } = await supabase
    .from('time_entries')
    .update({
      clock_out: new Date().toISOString(),
      is_full_day: data.isFullDay,
      notes: data.notes?.trim() || null,
      clocked_by_profile_id: profile.id,
    })
    .eq('id', data.entryId)
    .eq('company_id', user.company_id)

  if (error) return { error: error.message }
  return { ok: true }
}

export async function getProjectTeamStatus(projectId?: string) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, permissions')
    .eq('email', user.email)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!profile) return { error: 'Profile not found' }

  const isSupervisor = user.role === 'admin' || hasPermission(profile.permissions as EmployeePermissions | null, 'supervisor')
  const canCheckinTeam = hasPermission(profile.permissions as EmployeePermissions | null, 'checkin_team')

  if (!isSupervisor && !canCheckinTeam) return { error: 'Not authorized' }

  // With no projectId, this is the general company-wide "Team Clock" (the
  // /team/checkin hub) — every active employee in the company,
  // not scoped to one job site.
  let members: { profile: Record<string, unknown> }[] = []

  if (projectId) {
    const membersRes = await supabase
      .from('project_members')
      .select('profile:profile_id(id, full_name, daily_rate, hourly_rate)')
      .eq('project_id', projectId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    members = (membersRes.data ?? []) as any
  } else {
    const profilesRes = await supabase
      .from('profiles')
      .select('id, full_name, daily_rate, hourly_rate')
      .eq('company_id', user.company_id)
      .eq('role', 'employee')
      .eq('status', 'active')
    members = (profilesRes.data ?? []).map(p => ({ profile: p }))
  }

  // Active (open) entries — for one project's team, or company-wide when
  // no project was given.
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  let openEntriesQuery = supabase
    .from('time_entries')
    .select('id, employee_id, worker_id, clock_in, notes')
    .eq('company_id', user.company_id)
    .is('clock_out', null)
    .gte('clock_in', todayStart.toISOString())
  if (projectId) openEntriesQuery = openEntriesQuery.eq('project_id', projectId)

  const { data: openEntries } = await openEntriesQuery

  type ProfileMember = { id: string; full_name: string; daily_rate: number | null; hourly_rate: number }
  type OpenEntry     = { id: string; employee_id: string | null; worker_id: string | null; clock_in: string; notes: string | null }

  const profileList: ProfileMember[] = (members ?? []).map((m: Record<string, unknown>) => m.profile as ProfileMember).filter(Boolean)
  const entries: OpenEntry[] = (openEntries ?? []) as OpenEntry[]

  const team = [
    ...profileList.map(p => ({
      kind: 'profile' as const,
      id: p.id,
      full_name: p.full_name,
      daily_rate: p.daily_rate ?? p.hourly_rate * 8,
      entry: entries.find(e => e.employee_id === p.id) ?? null,
    })),
  ].sort((a, b) => a.full_name.localeCompare(b.full_name))

  return { ok: true, team }
}

// ─── Admin: manual time entry ─────────────────────────────────────────────────

export async function createManualTimeEntry(data: {
  profileId?: string
  workerId?: string
  clockIn: string
  clockOut?: string
  isFullDay?: boolean
  projectId?: string
  notes?: string
}) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  if (!data.profileId && !data.workerId) return { error: 'Must provide profileId or workerId' }

  if (data.clockOut && new Date(data.clockOut) <= new Date(data.clockIn)) {
    return { error: 'Clock-out must be after clock-in' }
  }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', user.email)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!profile) return { error: 'Profile not found' }

  const { error } = await supabase
    .from('time_entries')
    .insert({
      company_id: user.company_id,
      project_id: data.projectId ?? null,
      employee_id: data.profileId ?? null,
      worker_id: data.workerId ?? null,
      clock_in: data.clockIn,
      clock_out: data.clockOut ?? null,
      is_full_day: data.isFullDay ?? null,
      clocked_by_profile_id: profile.id,
      is_manual_entry: true,
      notes: data.notes?.trim() || null,
      approval_status: 'approved',
    })

  if (error) return { error: error.message }
  revalidatePath('/admin/time')
  return { ok: true }
}
