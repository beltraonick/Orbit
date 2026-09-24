'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { localDateTimeParts, zonedTimeToUtc, DEFAULT_CLOCK_WINDOW } from '@/lib/clock-window'
import {
  addDays,
  isDayOff,
  isFixedDayOff,
  isValidDateStr,
  normalizeWeeklyDaysOff,
  DEFAULT_LATE_CUTOFF,
} from '@/lib/schedule'

// Days off (fixed weekly, per date, and employee requests) and the "didn't
// clock in" alert. Tables come from migration 048; until it has been run,
// every read here reports `setupNeeded` instead of failing the screen.

type Supabase = ReturnType<typeof createClient>

// Postgres "undefined table/column" and PostgREST "not in schema cache".
function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '') ||
    /does not exist|schema cache/i.test(error.message ?? '')
}

const SETUP_NEEDED = 'Days off are not set up in the database yet (migration 048).'

async function loadCompanyClock(supabase: Supabase, companyId: string) {
  const { data } = await supabase
    .from('company_document_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()
  const timezone = (data?.timezone as string | undefined) || DEFAULT_CLOCK_WINDOW.timezone
  const cutoff = data?.enforce_clock_window && typeof data.clock_in_window_end === 'string'
    ? data.clock_in_window_end
    : DEFAULT_LATE_CUTOFF
  return { timezone, cutoff }
}

/** Today's date ('YYYY-MM-DD') and time ('HH:MM') in the company's timezone. */
async function companyNow(supabase: Supabase, companyId: string) {
  const clock = await loadCompanyClock(supabase, companyId)
  const { date, time } = localDateTimeParts(new Date(), clock.timezone)
  return { ...clock, today: date, now: time }
}

interface EmployeeRow { id: string; full_name: string; weekly_days_off: number[] }

async function loadActiveEmployees(supabase: Supabase, companyId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, weekly_days_off')
    .eq('company_id', companyId)
    .eq('role', 'employee')
    .eq('status', 'active')
    .order('full_name')
  if (error) return { error }
  const employees: EmployeeRow[] = (data ?? []).map(p => ({
    id: p.id as string,
    full_name: p.full_name as string,
    weekly_days_off: normalizeWeeklyDaysOff(p.weekly_days_off),
  }))
  return { employees }
}

async function loadOverrides(supabase: Supabase, companyId: string, from: string, to: string) {
  const { data, error } = await supabase
    .from('schedule_overrides')
    .select('employee_id, date, is_off')
    .eq('company_id', companyId)
    .gte('date', from)
    .lte('date', to)
  if (error) return { error }
  const map = new Map<string, boolean>() // `${employeeId}|${date}` -> is_off
  for (const o of data ?? []) map.set(`${o.employee_id}|${String(o.date).slice(0, 10)}`, o.is_off as boolean)
  return { map }
}

async function sessionProfileId(supabase: Supabase, email: string, companyId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .eq('company_id', companyId)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

// ─── Admin: week view ────────────────────────────────────────────────────────

export async function getWeekSchedule(weekStart: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) return { error: 'Unauthorized' }
  if (!isValidDateStr(weekStart)) return { error: 'Invalid date' }

  const supabase = createClient()
  const weekEnd = addDays(weekStart, 6)
  const [emps, overrides, requests, clock] = await Promise.all([
    loadActiveEmployees(supabase, user.company_id),
    loadOverrides(supabase, user.company_id, weekStart, weekEnd),
    supabase
      .from('day_off_requests')
      .select('id, employee_id, date, reason, created_at, employee:employee_id(full_name)')
      .eq('company_id', user.company_id)
      .eq('status', 'pending')
      .order('date'),
    companyNow(supabase, user.company_id),
  ])

  if ('error' in emps || 'error' in overrides || requests.error) {
    const err = ('error' in emps ? emps.error : null) ?? ('error' in overrides ? overrides.error : null) ?? requests.error
    if (isMissingSchema(err)) return { setupNeeded: true as const }
    return { error: err?.message ?? 'Could not load the schedule.' }
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  return {
    ok: true as const,
    today: clock.today,
    days,
    employees: emps.employees.map(e => ({
      id: e.id,
      full_name: e.full_name,
      weekly_days_off: e.weekly_days_off,
      week: days.map(date => {
        const override = overrides.map.get(`${e.id}|${date}`)
        return { date, off: isDayOff(e.weekly_days_off, override, date), changed: override !== undefined }
      }),
    })),
    requests: (requests.data ?? []).map(r => ({
      id: r.id as string,
      employee_id: r.employee_id as string,
      employee_name: (r.employee as unknown as { full_name: string } | null)?.full_name ?? '—',
      date: String(r.date).slice(0, 10),
      reason: (r.reason as string | null) ?? null,
    })),
  }
}

export async function setWeeklyDaysOff(employeeId: string, days: number[]) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) return { error: 'Unauthorized' }

  const supabase = createClient()
  const { error } = await supabase
    .from('profiles')
    .update({ weekly_days_off: normalizeWeeklyDaysOff(days) })
    .eq('id', employeeId)
    .eq('company_id', user.company_id)
  if (isMissingSchema(error)) return { error: SETUP_NEEDED }
  if (error) return { error: error.message }
  return { ok: true }
}

/** Makes `date` a day off (off = true) or a work day (off = false) for one employee. */
export async function setDayOff(employeeId: string, date: string, off: boolean) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) return { error: 'Unauthorized' }
  if (!isValidDateStr(date)) return { error: 'Invalid date' }

  const supabase = createClient()
  const result = await applyDayOff(supabase, user.company_id, user.email, employeeId, date, off)
  return result
}

async function applyDayOff(supabase: Supabase, companyId: string, adminEmail: string, employeeId: string, date: string, off: boolean) {
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, weekly_days_off')
    .eq('id', employeeId)
    .eq('company_id', companyId)
    .maybeSingle()
  if (isMissingSchema(profileErr)) return { error: SETUP_NEEDED }
  if (profileErr) return { error: profileErr.message }
  if (!profile) return { error: 'Employee not found' }

  // Matching the fixed schedule needs no override — remove it instead, so
  // later changes to the fixed days apply to this date too.
  const matchesFixed = isFixedDayOff(normalizeWeeklyDaysOff(profile.weekly_days_off), date) === off
  if (matchesFixed) {
    const { error } = await supabase
      .from('schedule_overrides')
      .delete()
      .eq('company_id', companyId)
      .eq('employee_id', employeeId)
      .eq('date', date)
    if (isMissingSchema(error)) return { error: SETUP_NEEDED }
    if (error) return { error: error.message }
    return { ok: true }
  }

  const createdBy = await sessionProfileId(supabase, adminEmail, companyId)
  const { error } = await supabase
    .from('schedule_overrides')
    .upsert(
      { company_id: companyId, employee_id: employeeId, date, is_off: off, created_by: createdBy },
      { onConflict: 'employee_id,date' },
    )
  if (isMissingSchema(error)) return { error: SETUP_NEEDED }
  if (error) return { error: error.message }
  return { ok: true }
}

export async function decideDayOffRequest(requestId: string, approve: boolean) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) return { error: 'Unauthorized' }

  const supabase = createClient()
  const { data: request, error: readErr } = await supabase
    .from('day_off_requests')
    .select('id, employee_id, date, status')
    .eq('id', requestId)
    .eq('company_id', user.company_id)
    .maybeSingle()
  if (isMissingSchema(readErr)) return { error: SETUP_NEEDED }
  if (readErr) return { error: readErr.message }
  if (!request) return { error: 'Request not found' }
  if (request.status !== 'pending') return { error: 'This request was already answered.' }

  if (approve) {
    const applied = await applyDayOff(supabase, user.company_id, user.email, request.employee_id as string, String(request.date).slice(0, 10), true)
    if (applied.error) return applied
  }

  const decidedBy = await sessionProfileId(supabase, user.email, user.company_id)
  const { error } = await supabase
    .from('day_off_requests')
    .update({ status: approve ? 'approved' : 'declined', decided_by: decidedBy, decided_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('company_id', user.company_id)
    .eq('status', 'pending')
  if (error) return { error: error.message }
  return { ok: true }
}

// ─── Employee: own days off and requests ─────────────────────────────────────

export async function getMyDaysOff() {
  const user = getCurrentUser()
  if (!user || !user.company_id) return { error: 'Unauthorized' }

  const supabase = createClient()
  const clock = await companyNow(supabase, user.company_id)
  const until = addDays(clock.today, 60)

  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('id, weekly_days_off')
    .eq('email', user.email)
    .eq('company_id', user.company_id)
    .maybeSingle()
  if (isMissingSchema(profileErr)) return { setupNeeded: true as const }
  if (profileErr) return { error: profileErr.message }
  if (!profile) return { error: 'Profile not found' }

  const [overrides, requests] = await Promise.all([
    supabase
      .from('schedule_overrides')
      .select('date, is_off')
      .eq('company_id', user.company_id)
      .eq('employee_id', profile.id)
      .gte('date', clock.today)
      .lte('date', until)
      .order('date'),
    supabase
      .from('day_off_requests')
      .select('id, date, reason, status, created_at')
      .eq('company_id', user.company_id)
      .eq('employee_id', profile.id)
      .gte('date', addDays(clock.today, -30))
      .order('date', { ascending: false })
      .limit(30),
  ])
  if (isMissingSchema(overrides.error) || isMissingSchema(requests.error)) return { setupNeeded: true as const }
  if (overrides.error || requests.error) return { error: (overrides.error ?? requests.error)!.message }

  return {
    ok: true as const,
    today: clock.today,
    weeklyDaysOff: normalizeWeeklyDaysOff(profile.weekly_days_off),
    overrides: (overrides.data ?? []).map(o => ({ date: String(o.date).slice(0, 10), off: o.is_off as boolean })),
    requests: (requests.data ?? []).map(r => ({
      id: r.id as string,
      date: String(r.date).slice(0, 10),
      reason: (r.reason as string | null) ?? null,
      status: (r.status === 'approved' || r.status === 'declined' ? r.status : 'pending') as 'pending' | 'approved' | 'declined',
    })),
  }
}

export async function requestDayOff(date: string, reason: string) {
  const user = getCurrentUser()
  if (!user || !user.company_id || user.role === 'admin') return { error: 'Unauthorized' }
  if (!isValidDateStr(date)) return { error: 'Invalid date' }

  const supabase = createClient()
  const clock = await companyNow(supabase, user.company_id)
  if (date < clock.today) return { error: 'past' as const }

  const employeeId = await sessionProfileId(supabase, user.email, user.company_id)
  if (!employeeId) return { error: 'Profile not found' }

  const { data: existing, error: dupErr } = await supabase
    .from('day_off_requests')
    .select('id')
    .eq('company_id', user.company_id)
    .eq('employee_id', employeeId)
    .eq('date', date)
    .eq('status', 'pending')
    .maybeSingle()
  if (isMissingSchema(dupErr)) return { error: SETUP_NEEDED }
  if (dupErr) return { error: dupErr.message }
  if (existing) return { error: 'duplicate' as const }

  const { error } = await supabase
    .from('day_off_requests')
    .insert({ company_id: user.company_id, employee_id: employeeId, date, reason: reason.trim().slice(0, 500) || null, status: 'pending' })
  if (isMissingSchema(error)) return { error: SETUP_NEEDED }
  if (error) return { error: error.message }
  return { ok: true }
}

export async function cancelDayOffRequest(requestId: string) {
  const user = getCurrentUser()
  if (!user || !user.company_id) return { error: 'Unauthorized' }

  const supabase = createClient()
  const employeeId = await sessionProfileId(supabase, user.email, user.company_id)
  if (!employeeId) return { error: 'Profile not found' }

  const { error } = await supabase
    .from('day_off_requests')
    .delete()
    .eq('id', requestId)
    .eq('company_id', user.company_id)
    .eq('employee_id', employeeId)
    .eq('status', 'pending')
  if (error) return { error: error.message }
  return { ok: true }
}

// ─── "Didn't clock in" alert ─────────────────────────────────────────────────

export interface AttendanceStatus {
  today: string
  cutoff: string
  pastCutoff: boolean
  offTodayIds: string[]
  missing: { id: string; full_name: string }[]
  pendingRequests: number
}

/**
 * Who is working today (not off) and still hasn't clocked in. `missing` is
 * only filled once it's past the cutoff (9:00 AM company time by default).
 * Never throws — on any problem it returns null and screens just skip the alert.
 */
export async function getAttendanceStatus(): Promise<AttendanceStatus | null> {
  const user = getCurrentUser()
  if (!user || !user.company_id) return null
  const companyId = user.company_id
  try {
    const supabase = createClient()
    const clock = await companyNow(supabase, companyId)
    const emps = await loadActiveEmployees(supabase, companyId)
    // Before migration 048 there's no weekly_days_off column: fall back to
    // "everyone works every day" so the alert still works.
    let employees: EmployeeRow[]
    if ('error' in emps) {
      if (!isMissingSchema(emps.error)) return null
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('company_id', companyId)
        .eq('role', 'employee')
        .eq('status', 'active')
        .order('full_name')
      employees = (data ?? []).map(p => ({ id: p.id as string, full_name: p.full_name as string, weekly_days_off: [] }))
    } else {
      employees = emps.employees
    }

    const overrides = await loadOverrides(supabase, companyId, clock.today, clock.today)
    const overrideMap: Map<string, boolean> = ('map' in overrides && overrides.map) || new Map<string, boolean>()
    const offTodayIds = employees
      .filter(e => isDayOff(e.weekly_days_off, overrideMap.get(`${e.id}|${clock.today}`), clock.today))
      .map(e => e.id)

    const { count: pendingRequests } = await supabase
      .from('day_off_requests')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('status', 'pending')

    const pastCutoff = clock.now >= clock.cutoff
    let missing: { id: string; full_name: string }[] = []
    if (pastCutoff) {
      const dayStart = zonedTimeToUtc(clock.today, '00:00', clock.timezone)
      const { data: entries, error } = await supabase
        .from('time_entries')
        .select('employee_id')
        .eq('company_id', companyId)
        .gte('clock_in', dayStart.toISOString())
      if (error) return null
      const clockedIn = new Set((entries ?? []).map(e => e.employee_id as string | null).filter(Boolean))
      const off = new Set(offTodayIds)
      missing = employees
        .filter(e => !off.has(e.id) && !clockedIn.has(e.id))
        .map(e => ({ id: e.id, full_name: e.full_name }))
    }

    return { today: clock.today, cutoff: clock.cutoff, pastCutoff, offTodayIds, missing, pendingRequests: pendingRequests ?? 0 }
  } catch {
    return null
  }
}
