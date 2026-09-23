'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type CompensationCategory = 'extra_work' | 'bonus' | 'correction' | 'production'

export async function createManualCompensation(data: {
  person_type: 'employee' | 'worker'
  person_id: string
  person_name: string
  amount: number
  compensation_date: string
  category: CompensationCategory
  description: string
  project_id?: string | null
}) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }
  if (!data.amount || data.amount === 0) return { error: 'Amount must not be zero.' }
  if (!data.description.trim()) return { error: 'A description is required for audit purposes.' }

  const supabase = createClient()

  // Confirm the person actually belongs to this admin's company before
  // attributing pay to them — person_id has no DB-level FK/tenant check
  // (it's polymorphic across profiles/workers), so this must be verified
  // in code, not assumed from the request.
  const personTable = data.person_type === 'employee' ? 'profiles' : 'workers'
  const { data: person } = await supabase
    .from(personTable)
    .select('id')
    .eq('id', data.person_id)
    .eq('company_id', user.company_id)
    .maybeSingle()
  if (!person) return { error: 'That person does not belong to your company.' }

  const { data: row, error } = await supabase
    .from('manual_compensations')
    .insert({
      company_id: user.company_id,
      person_type: data.person_type,
      person_id: data.person_id,
      person_name: data.person_name,
      amount: data.amount,
      compensation_date: data.compensation_date,
      category: data.category,
      description: data.description.trim(),
      project_id: data.project_id || null,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/admin/payroll')
  return { success: true, id: row.id as string }
}

// Locked entries (payroll_period_id set, i.e. already inside a finalized
// payroll period) cannot be deleted — that period's numbers are permanent.
export async function deleteManualCompensation(id: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()
  const { data: existing } = await supabase
    .from('manual_compensations')
    .select('id, payroll_period_id')
    .eq('id', id)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!existing) return { error: 'Not found.' }
  if (existing.payroll_period_id) {
    return { error: 'This entry is part of a finalized payroll period and cannot be deleted.' }
  }

  const { error } = await supabase.from('manual_compensations').delete().eq('id', id).eq('company_id', user.company_id)
  if (error) return { error: error.message }
  revalidatePath('/admin/payroll')
  return { success: true }
}

export async function listManualCompensations(periodStart: string, periodEnd: string) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()
  const { data, error } = await supabase
    .from('manual_compensations')
    .select(`
      id, person_type, person_id, person_name, amount, compensation_date, category, description, payroll_period_id,
      project:project_id(name),
      created_by_profile:created_by(full_name)
    `)
    .eq('company_id', user.company_id)
    .gte('compensation_date', periodStart)
    .lte('compensation_date', periodEnd)
    .order('compensation_date', { ascending: false })

  if (error) return { error: error.message }
  return { success: true, entries: data ?? [] }
}
