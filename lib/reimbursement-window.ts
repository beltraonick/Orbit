// Which expense dates a pay period's reimbursements are taken from.
//
// Normally a reimbursement is paid with the period its expense date falls
// in. But if the period right before this one was already paid (finalized)
// and an expense dated inside it was only approved afterwards, it would
// never be picked up again — its own period is closed. So when the previous
// period is finalized, this period also collects the still-unpaid (not
// locked) reimbursements dated in it.
//
// Must be used by every place that lists or locks a period's
// reimbursements (Payroll, employee Pay, Finalize Payroll) so they always
// agree — otherwise an expense could be shown but not locked, and paid twice.
//
// Works with the browser or the server Supabase client. Never throws: on any
// problem it returns periodStart (the old behavior).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function reimbursementWindowStart(supabase: any, companyId: string | null | undefined, periodStart: string): Promise<string> {
  if (!companyId || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return periodStart
  try {
    const [y, m, d] = periodStart.split('-').map(Number)
    const dayBefore = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from('payroll_periods')
      .select('period_start')
      .eq('company_id', companyId)
      .eq('period_end', dayBefore)
      .order('period_start', { ascending: true })
      .limit(1)
    if (error || !data || data.length === 0) return periodStart
    const prevStart = String(data[0].period_start).slice(0, 10)
    return prevStart < periodStart ? prevStart : periodStart
  } catch {
    return periodStart
  }
}
