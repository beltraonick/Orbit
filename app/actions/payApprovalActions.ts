'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { localDateTimeParts, DEFAULT_CLOCK_WINDOW } from '@/lib/clock-window'
import { isValidDateStr } from '@/lib/schedule'

// Employee "Approve payment" for a pay period (migration 048). The row keeps
// the amount and days the employee saw when approving; Payroll compares it
// with the live total, so a later change to their days or rate shows up as
// "changed after approval" instead of silently counting as approved.

function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code ?? '') ||
    /does not exist|schema cache/i.test(error.message ?? '')
}

export interface PayApproval {
  employee_id: string
  amount: number
  days_worked: number | null
  approved_at: string
}

// The session id isn't guaranteed to be the profiles.id (demo/seed
// accounts), so resolve the profile the same way the Pay screen does.
async function myProfileId(supabase: ReturnType<typeof createClient>, email: string, companyId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('email', email)
    .eq('company_id', companyId)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

function toApproval(r: Record<string, unknown>): PayApproval {
  return {
    employee_id: r.employee_id as string,
    amount: Number(r.amount),
    days_worked: r.days_worked != null ? Number(r.days_worked) : null,
    approved_at: r.approved_at as string,
  }
}

export async function getMyPayApproval(periodStart: string, periodEnd: string) {
  const user = getCurrentUser()
  if (!user || !user.company_id) return { error: 'Unauthorized' }
  if (!isValidDateStr(periodStart) || !isValidDateStr(periodEnd)) return { error: 'Invalid period' }

  const supabase = createClient()
  const employeeId = await myProfileId(supabase, user.email, user.company_id)
  if (!employeeId) return { ok: true as const, approval: null }
  const { data, error } = await supabase
    .from('pay_approvals')
    .select('employee_id, amount, days_worked, approved_at')
    .eq('company_id', user.company_id)
    .eq('employee_id', employeeId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle()
  if (isMissingSchema(error)) return { setupNeeded: true as const }
  if (error) return { error: error.message }
  return { ok: true as const, approval: data ? toApproval(data) : null }
}

export async function approvePay(input: { periodStart: string; periodEnd: string; amount: number; daysWorked: number | null }) {
  const user = getCurrentUser()
  if (!user || !user.company_id || user.role === 'admin') return { error: 'Unauthorized' }
  const { periodStart, periodEnd } = input
  if (!isValidDateStr(periodStart) || !isValidDateStr(periodEnd) || periodStart > periodEnd) return { error: 'Invalid period' }
  const amount = Math.round(Number(input.amount) * 100) / 100
  if (!Number.isFinite(amount) || amount < 0) return { error: 'Invalid amount' }
  const daysWorked = input.daysWorked != null && Number.isFinite(Number(input.daysWorked)) ? Number(input.daysWorked) : null

  const supabase = createClient()

  // Only a period that has already ended can be approved — the days in it
  // can't change anymore by the employee working more.
  const { data: settings } = await supabase
    .from('company_document_settings')
    .select('*')
    .eq('company_id', user.company_id)
    .maybeSingle()
  const timezone = (settings?.timezone as string | undefined) || DEFAULT_CLOCK_WINDOW.timezone
  const today = localDateTimeParts(new Date(), timezone).date
  if (periodEnd >= today) return { error: 'not_ended' as const }

  const { data: finalized } = await supabase
    .from('payroll_periods')
    .select('id')
    .eq('company_id', user.company_id)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle()
  if (finalized) return { error: 'already_paid' as const }

  const employeeId = await myProfileId(supabase, user.email, user.company_id)
  if (!employeeId) return { error: 'Profile not found' }

  const { data: existing, error: readErr } = await supabase
    .from('pay_approvals')
    .select('employee_id, amount, days_worked, approved_at')
    .eq('company_id', user.company_id)
    .eq('employee_id', employeeId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
    .maybeSingle()
  if (isMissingSchema(readErr)) return { error: 'setup_needed' as const }
  if (readErr) return { error: readErr.message }
  // Already approved for this exact amount — nothing to redo.
  if (existing && Math.abs(Number(existing.amount) - amount) < 0.005) {
    return { ok: true as const, approval: toApproval(existing) }
  }

  const { data, error } = await supabase
    .from('pay_approvals')
    .upsert(
      {
        company_id: user.company_id,
        employee_id: employeeId,
        period_start: periodStart,
        period_end: periodEnd,
        amount,
        days_worked: daysWorked,
        approved_at: new Date().toISOString(),
        seen_at: null,
      },
      { onConflict: 'company_id,employee_id,period_start,period_end' },
    )
    .select('employee_id, amount, days_worked, approved_at')
    .single()
  if (isMissingSchema(error)) return { error: 'setup_needed' as const }
  if (error || !data) return { error: error?.message ?? 'Could not save the approval.' }
  return { ok: true as const, approval: toApproval(data) }
}

/** Admin: every approval for a period. Also marks them as seen (clears the Payroll badge). */
export async function getPayApprovals(periodStart: string, periodEnd: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) return { error: 'Unauthorized' }
  if (!isValidDateStr(periodStart) || !isValidDateStr(periodEnd)) return { error: 'Invalid period' }

  const supabase = createClient()
  const { data, error } = await supabase
    .from('pay_approvals')
    .select('employee_id, amount, days_worked, approved_at, seen_at')
    .eq('company_id', user.company_id)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd)
  if (isMissingSchema(error)) return { setupNeeded: true as const }
  if (error) return { error: error.message }

  if ((data ?? []).some(r => !r.seen_at)) {
    await supabase
      .from('pay_approvals')
      .update({ seen_at: new Date().toISOString() })
      .eq('company_id', user.company_id)
      .eq('period_start', periodStart)
      .eq('period_end', periodEnd)
      .is('seen_at', null)
  }
  return { ok: true as const, approvals: (data ?? []).map(toApproval) }
}

/** Admin: how many approvals haven't been looked at yet (for the menu badge). Never throws. */
export async function countUnseenPayApprovals(): Promise<number> {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) return 0
  try {
    const supabase = createClient()
    const { count, error } = await supabase
      .from('pay_approvals')
      .select('employee_id', { count: 'exact', head: true })
      .eq('company_id', user.company_id)
      .is('seen_at', null)
    if (error) return 0
    return count ?? 0
  } catch {
    return 0
  }
}
