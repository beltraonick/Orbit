'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { calcEntryPay } from '@/lib/payroll-calc'

function toISO(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toISOString()
}
function toISOEnd(dateStr: string) {
  return new Date(dateStr + 'T23:59:59').toISOString()
}

type RawEntry = {
  id: string
  clock_in: string
  clock_out: string | null
  hours_worked: number | null
  is_full_day: boolean | null
  notes: string | null
  employee_id: string | null
  worker_id: string | null
  project: { name: string } | null
  profile: { full_name: string; daily_rate: number | null; hourly_rate: number | null } | null
  worker: { full_name: string; daily_rate: number | null; hourly_rate: number | null } | null
}

type RawManualComp = {
  id: string
  person_type: 'employee' | 'worker'
  person_id: string
  person_name: string
  amount: number
  compensation_date: string
  category: 'extra_work' | 'bonus' | 'correction' | 'production'
  description: string
  project: { name: string } | null
}

// Freezes a pay period so its numbers can never change again, even if rates,
// the company Pay System, or the underlying time_entries rows change later.
// There is deliberately no "un-finalize" — once paid, a period stays exactly
// as it was paid.
export async function finalizePayrollPeriod(periodStart: string, periodEnd: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }
  if (!periodStart || !periodEnd) return { error: 'Missing period dates' }

  const supabase = createClient()
  const companyId = user.company_id

  const { data: existing } = await supabase
    .from('payroll_periods')
    .select('id')
    .eq('company_id', companyId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle()

  if (existing) {
    return { error: 'This period has already been finalized and cannot be finalized again.' }
  }

  const [{ data: entries }, { data: manualComps }] = await Promise.all([
    supabase
      .from('time_entries')
      .select(`
        id, clock_in, clock_out, is_full_day, notes, employee_id, worker_id,
        project:project_id(name),
        profile:employee_id(full_name, daily_rate, hourly_rate),
        worker:worker_id(full_name, daily_rate, hourly_rate)
      `)
      .eq('company_id', companyId)
      .not('clock_out', 'is', null)
      .gte('clock_in', toISO(periodStart))
      .lte('clock_in', toISOEnd(periodEnd)),
    supabase
      .from('manual_compensations')
      .select('id, person_type, person_id, person_name, amount, compensation_date, category, description, project:project_id(name)')
      .eq('company_id', companyId)
      .is('payroll_period_id', null)
      .gte('compensation_date', periodStart)
      .lte('compensation_date', periodEnd),
  ])

  const rawEntries = (entries ?? []) as unknown as RawEntry[]
  const rawManualComps = (manualComps ?? []) as unknown as RawManualComp[]
  if (rawEntries.length === 0 && rawManualComps.length === 0) {
    return { error: 'No time entries or manual compensation found in this period — nothing to finalize.' }
  }

  const timeEntrySnapshotRows = rawEntries.map(e => {
    const calc = calcEntryPay({
      clock_in: e.clock_in,
      clock_out: e.clock_out,
      hours_worked: e.hours_worked,
      is_full_day: e.is_full_day,
      daily_rate: e.profile?.daily_rate ?? e.worker?.daily_rate ?? null,
      hourly_rate: e.profile?.hourly_rate ?? e.worker?.hourly_rate ?? null,
    })
    return {
      company_id: companyId,
      source_type: 'time_entry' as const,
      source_time_entry_id: e.id,
      source_manual_compensation_id: null,
      person_type: e.employee_id ? 'employee' as const : 'worker' as const,
      person_id: (e.employee_id ?? e.worker_id) as string,
      person_name: e.profile?.full_name ?? e.worker?.full_name ?? 'Unknown',
      entry_date: e.clock_in.slice(0, 10),
      project_name: e.project?.name ?? null,
      pay_mode: calc.payMode,
      daily_rate: calc.dailyRate,
      hourly_rate: calc.hourlyRate,
      hours_worked: calc.hoursWorked,
      is_full_day: e.is_full_day,
      full_day: calc.fullDay,
      notes: e.notes,
      total_pay: calc.totalPay,
      overtime_hours: calc.overtimeHours,
      overtime_pay: calc.overtimePay,
    }
  })

  const manualCompSnapshotRows = rawManualComps.map(m => ({
    company_id: companyId,
    source_type: 'manual_compensation' as const,
    source_time_entry_id: null,
    source_manual_compensation_id: m.id,
    person_type: m.person_type,
    person_id: m.person_id,
    person_name: m.person_name,
    entry_date: m.compensation_date,
    project_name: m.project?.name ?? null,
    pay_mode: 'manual' as const,
    category: m.category,
    daily_rate: 0,
    hourly_rate: 0,
    hours_worked: null,
    is_full_day: null,
    full_day: false,
    notes: m.description,
    total_pay: Number(m.amount),
    overtime_hours: 0,
    overtime_pay: 0,
  }))

  const snapshotRows = [...timeEntrySnapshotRows, ...manualCompSnapshotRows]
  const grandTotal = snapshotRows.reduce((s, r) => s + r.total_pay + r.overtime_pay, 0)

  const { data: period, error: periodError } = await supabase
    .from('payroll_periods')
    .insert({
      company_id: companyId,
      period_start: periodStart,
      period_end: periodEnd,
      finalized_by: user.id,
      grand_total: grandTotal,
    })
    .select('id, finalized_at')
    .single()

  if (periodError || !period) {
    return { error: periodError?.message ?? 'Failed to create payroll period.' }
  }

  const { error: insertError } = await supabase
    .from('payroll_period_entries')
    .insert(snapshotRows.map(r => ({ ...r, payroll_period_id: period.id })))

  if (insertError) {
    // Roll back the period row so a half-written finalize doesn't block retrying.
    await supabase.from('payroll_periods').delete().eq('id', period.id).eq('company_id', companyId)
    return { error: insertError.message }
  }

  if (rawManualComps.length > 0) {
    await supabase
      .from('manual_compensations')
      .update({ payroll_period_id: period.id })
      .in('id', rawManualComps.map(m => m.id))
  }

  return { success: true, finalizedAt: period.finalized_at as string, entryCount: snapshotRows.length, grandTotal }
}

export async function getFinalizedPayrollPeriod(periodStart: string, periodEnd: string) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()
  const { data: period } = await supabase
    .from('payroll_periods')
    .select('id, finalized_at, finalized_by, grand_total, finalized_by_profile:finalized_by(full_name)')
    .eq('company_id', user.company_id)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle()

  if (!period) return { finalized: false as const }

  const { data: entries } = await supabase
    .from('payroll_period_entries')
    .select('*')
    .eq('payroll_period_id', period.id)
    .eq('company_id', user.company_id)
    .order('entry_date', { ascending: true })

  return {
    finalized: true as const,
    finalizedAt: period.finalized_at as string,
    finalizedByName: (period.finalized_by_profile as unknown as { full_name: string } | null)?.full_name ?? null,
    grandTotal: Number(period.grand_total),
    entries: entries ?? [],
  }
}
