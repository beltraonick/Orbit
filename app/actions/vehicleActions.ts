'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getVehicles() {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()
  const { data, error } = await supabase
    .from('vehicles')
    .select(`
      id, name, license_plate, vehicle_type, year, make, model, color, status,
      assigned_to:assigned_to_profile_id(id, full_name)
    `)
    .eq('company_id', user.company_id)
    .order('name')

  if (error) return { error: error.message }
  return { ok: true, vehicles: data ?? [] }
}

export async function createVehicle(data: {
  name: string
  license_plate?: string
  vehicle_type: 'company' | 'personal' | 'rental'
  year?: number
  make?: string
  model?: string
  color?: string
  assigned_to_profile_id?: string
}) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()

  const { data: vehicle, error } = await supabase
    .from('vehicles')
    .insert({
      company_id: user.company_id,
      name: data.name.trim(),
      license_plate: data.license_plate?.trim() || null,
      vehicle_type: data.vehicle_type,
      year: data.year ?? null,
      make: data.make?.trim() || null,
      model: data.model?.trim() || null,
      color: data.color?.trim() || null,
      assigned_to_profile_id: data.assigned_to_profile_id ?? null,
      status: 'active',
    })
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  revalidatePath('/admin/vehicles')
  return { ok: true, id: vehicle?.id }
}

export async function updateVehicle(
  vehicleId: string,
  data: {
    name?: string
    license_plate?: string | null
    vehicle_type?: 'company' | 'personal' | 'rental'
    year?: number | null
    make?: string | null
    model?: string | null
    color?: string | null
    assigned_to_profile_id?: string | null
    status?: 'active' | 'archived'
  }
) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()

  const payload: Record<string, unknown> = {}
  if (data.name !== undefined) payload.name = data.name.trim()
  if (data.license_plate !== undefined) payload.license_plate = data.license_plate?.trim() || null
  if (data.vehicle_type !== undefined) payload.vehicle_type = data.vehicle_type
  if (data.year !== undefined) payload.year = data.year
  if (data.make !== undefined) payload.make = data.make?.trim() || null
  if (data.model !== undefined) payload.model = data.model?.trim() || null
  if (data.color !== undefined) payload.color = data.color?.trim() || null
  if (data.assigned_to_profile_id !== undefined) payload.assigned_to_profile_id = data.assigned_to_profile_id
  if (data.status !== undefined) payload.status = data.status

  const { error } = await supabase
    .from('vehicles')
    .update(payload)
    .eq('id', vehicleId)
    .eq('company_id', user.company_id)

  if (error) return { error: error.message }
  revalidatePath('/admin/vehicles')
  return { ok: true }
}

export async function deleteVehicle(vehicleId: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()

  // Check if vehicle is used in any trips
  const { count } = await supabase
    .from('mileage_trips')
    .select('id', { count: 'exact', head: true })
    .eq('vehicle_id', vehicleId)
    .eq('company_id', user.company_id)

  if ((count ?? 0) > 0) return { error: 'Vehicle is used in mileage trips and cannot be deleted. Archive it instead.' }

  const { error } = await supabase
    .from('vehicles')
    .delete()
    .eq('id', vehicleId)
    .eq('company_id', user.company_id)

  if (error) return { error: error.message }
  revalidatePath('/admin/vehicles')
  return { ok: true }
}
