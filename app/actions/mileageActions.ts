'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { hasPermission, type EmployeePermissions } from '@/lib/permissions'
import { revalidatePath } from 'next/cache'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getCallerProfile(supabase: ReturnType<typeof createClient>, email: string, company_id: string) {
  const { data } = await supabase
    .from('profiles')
    .select('id, permissions')
    .eq('email', email)
    .eq('company_id', company_id)
    .maybeSingle()
  return data
}

// ─── Vehicles ─────────────────────────────────────────────────────────────────

export async function getVehicles() {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, name, license_plate, vehicle_type, year, make, model, color, status, assigned_to_profile_id')
    .eq('company_id', user.company_id)
    .eq('status', 'active')
    .order('name')

  if (error) return { error: error.message }
  return { ok: true, vehicles: data ?? [] }
}

// ─── Mileage rate policy ──────────────────────────────────────────────────────

export async function getMileageRate() {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()
  const { data, error } = await supabase
    .from('company_document_settings')
    .select('mileage_rate_per_mile')
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (error) return { error: error.message }
  return { ok: true, rate: data?.mileage_rate_per_mile ?? 0.67 }
}

export async function updateMileageRate(rate: number) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()
  const { error } = await supabase
    .from('company_document_settings')
    .upsert({ company_id: user.company_id, mileage_rate_per_mile: rate }, { onConflict: 'company_id' })

  if (error) return { error: error.message }
  revalidatePath('/admin/settings')
  revalidatePath('/admin/mileage')
  return { ok: true }
}

// ─── Mileage trips ────────────────────────────────────────────────────────────

export async function getMileageTrips(filter?: 'all' | 'pending' | 'approved') {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  let query = supabase
    .from('mileage_trips')
    .select(`
      id, trip_date, origin, destination, purpose, distance_miles, trip_type,
      approval_status, reimbursement_amount,
      vehicle:vehicle_id(id, name, license_plate),
      project:project_id(id, name),
      employee:employee_profile_id(id, full_name),
      reviewer_notes, created_at
    `)
    .eq('company_id', user.company_id)
    .order('trip_date', { ascending: false })

  // Employees see only their own trips
  if (user.role === 'employee') {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    const canTrack = hasPermission(profile.permissions as EmployeePermissions | null, 'track_mileage')
    if (!canTrack) return { error: 'Not authorized' }
    query = query.eq('employee_profile_id', profile.id)
  }

  if (filter === 'pending') {
    query = query.in('approval_status', ['submitted', 'needs_review'])
  } else if (filter === 'approved') {
    query = query.eq('approval_status', 'approved')
  }

  const { data, error } = await query
  if (error) return { error: error.message }
  return { ok: true, trips: data ?? [] }
}

export async function createMileageTrip(data: {
  trip_date: string
  origin: string
  destination: string
  purpose?: string
  distance_miles: number
  trip_type: 'manual' | 'gps'
  vehicle_id?: string
  project_id?: string
  gps_start_lat?: number
  gps_start_lng?: number
  gps_end_lat?: number
  gps_end_lng?: number
}) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  let profile_id: string
  if (user.role === 'admin') {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    profile_id = profile.id
  } else {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    const canTrack = hasPermission(profile.permissions as EmployeePermissions | null, 'track_mileage')
    if (!canTrack) return { error: 'Not authorized' }
    // Manual entry requires extra permission
    if (data.trip_type === 'manual') {
      const canManual = hasPermission(profile.permissions as EmployeePermissions | null, 'manual_mileage')
      if (!canManual) return { error: 'Manual mileage entry not authorized' }
    }
    profile_id = profile.id
  }

  const { data: rateRow } = await supabase
    .from('company_document_settings')
    .select('mileage_rate_per_mile')
    .eq('company_id', user.company_id)
    .maybeSingle()

  const rate = rateRow?.mileage_rate_per_mile ?? 0.67
  const reimbursement = Math.round(data.distance_miles * rate * 100) / 100

  const row = {
    company_id: user.company_id,
    employee_profile_id: profile_id,
    trip_date: data.trip_date,
    origin: data.origin.trim(),
    destination: data.destination.trim(),
    purpose: data.purpose?.trim() || null,
    distance_miles: data.distance_miles,
    trip_type: data.trip_type,
    vehicle_id: data.vehicle_id ?? null,
    project_id: data.project_id ?? null,
    reimbursement_amount: reimbursement,
    approval_status: 'draft',
    gps_start_lat: data.gps_start_lat ?? null,
    gps_start_lng: data.gps_start_lng ?? null,
    gps_end_lat: data.gps_end_lat ?? null,
    gps_end_lng: data.gps_end_lng ?? null,
    }
  // Databases created from migration 029 still have the legacy NOT NULL
  // employee_id column; fill it too. If a database doesn't have that column,
  // PostgREST rejects the unknown column (PGRST204) — retry without it.
  let { data: trip, error } = await supabase
    .from('mileage_trips')
    .insert({ ...row, employee_id: profile_id })
    .select('id')
    .maybeSingle()
  if (error?.code === 'PGRST204') {
    ({ data: trip, error } = await supabase.from('mileage_trips').insert(row).select('id').maybeSingle())
  }

  if (error) return { error: error.message }
  revalidatePath('/admin/mileage')
  revalidatePath('/mileage')
  return { ok: true, id: trip?.id }
}

export async function submitMileageTrip(tripId: string) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  let query = supabase
    .from('mileage_trips')
    .update({ approval_status: 'submitted' })
    .eq('id', tripId)
    .eq('company_id', user.company_id)
    .eq('approval_status', 'draft')

  if (user.role === 'employee') {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    const canTrack = hasPermission(profile.permissions as EmployeePermissions | null, 'track_mileage')
    if (!canTrack) return { error: 'Not authorized' }
    query = query.eq('employee_profile_id', profile.id)
  }

  const { error } = await query
  if (error) return { error: error.message }
  revalidatePath('/admin/mileage')
  revalidatePath('/mileage')
  return { ok: true }
}

export async function approveMileageTrip(tripId: string, notes?: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()
  const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
  if (!profile) return { error: 'Profile not found' }

  const { error } = await supabase
    .from('mileage_trips')
    .update({
      approval_status: 'approved',
      reviewed_by_profile_id: profile.id,
      reviewer_notes: notes?.trim() || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', tripId)
    .eq('company_id', user.company_id)

  if (error) return { error: error.message }
  revalidatePath('/admin/mileage')
  revalidatePath('/admin/approvals')
  return { ok: true }
}

export async function rejectMileageTrip(tripId: string, notes?: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()
  const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
  if (!profile) return { error: 'Profile not found' }

  const { error } = await supabase
    .from('mileage_trips')
    .update({
      approval_status: 'rejected',
      reviewed_by_profile_id: profile.id,
      reviewer_notes: notes?.trim() || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', tripId)
    .eq('company_id', user.company_id)

  if (error) return { error: error.message }
  revalidatePath('/admin/mileage')
  revalidatePath('/admin/approvals')
  return { ok: true }
}

export async function updateMileageTrip(
  tripId: string,
  data: {
    trip_date?: string
    origin?: string
    destination?: string
    purpose?: string
    distance_miles?: number
    vehicle_id?: string | null
    project_id?: string | null
  }
) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  const payload: Record<string, unknown> = {}
  if (data.trip_date !== undefined) payload.trip_date = data.trip_date
  if (data.origin !== undefined) payload.origin = data.origin.trim()
  if (data.destination !== undefined) payload.destination = data.destination.trim()
  if (data.purpose !== undefined) payload.purpose = data.purpose?.trim() || null
  if (data.vehicle_id !== undefined) payload.vehicle_id = data.vehicle_id
  if (data.project_id !== undefined) payload.project_id = data.project_id

  if (data.distance_miles !== undefined) {
    payload.distance_miles = data.distance_miles
    const { data: rateRow } = await supabase
      .from('company_document_settings')
      .select('mileage_rate_per_mile')
      .eq('company_id', user.company_id)
      .maybeSingle()
    const rate = rateRow?.mileage_rate_per_mile ?? 0.67
    payload.reimbursement_amount = Math.round(data.distance_miles * rate * 100) / 100
  }

  let query = supabase
    .from('mileage_trips')
    .update(payload)
    .eq('id', tripId)
    .eq('company_id', user.company_id)
    .in('approval_status', ['draft', 'needs_review'])

  if (user.role === 'employee') {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    const canTrack = hasPermission(profile.permissions as EmployeePermissions | null, 'track_mileage')
    if (!canTrack) return { error: 'Not authorized' }
    query = query.eq('employee_profile_id', profile.id)
  }

  const { error } = await query
  if (error) return { error: error.message }
  revalidatePath('/admin/mileage')
  revalidatePath('/mileage')
  return { ok: true }
}

export async function deleteMileageTrip(tripId: string) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  let query = supabase
    .from('mileage_trips')
    .delete()
    .eq('id', tripId)
    .eq('company_id', user.company_id)
    .eq('approval_status', 'draft')

  if (user.role === 'employee') {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    query = query.eq('employee_profile_id', profile.id)
  }

  const { error } = await query
  if (error) return { error: error.message }
  revalidatePath('/admin/mileage')
  revalidatePath('/mileage')
  return { ok: true }
}
