import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { calcEntryPay } from '@/lib/payroll-calc'

function periodDates(period: string): { start: Date | null; end: Date | null } {
  const now = new Date()
  if (period === 'week') {
    const d = new Date(now)
    d.setDate(now.getDate() - now.getDay())
    d.setHours(0, 0, 0, 0)
    return { start: d, end: null }
  }
  if (period === 'last_week') {
    const s = new Date(now)
    s.setDate(now.getDate() - now.getDay() - 7)
    s.setHours(0, 0, 0, 0)
    const e = new Date(now)
    e.setDate(now.getDate() - now.getDay() - 1)
    e.setHours(23, 59, 59, 999)
    return { start: s, end: e }
  }
  if (period === 'month') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null }
  }
  if (period === 'last_month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
    }
  }
  return { start: null, end: null }
}

function buildPeriodLabel(period: string, start: Date | null, end: Date | null): string {
  if (!start) return 'All Time'
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })
  return `${fmt(start)} – ${fmt(end ?? new Date())}`
}

export async function GET(req: Request) {
  const user = getCurrentUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  if (user.role !== 'admin' && user.role !== 'owner') return new Response('Forbidden', { status: 403 })

  const { searchParams } = new URL(req.url)
  const period = searchParams.get('period') ?? 'month'
  const { start, end } = periodDates(period)
  const supabase = createClient()
  const cid = user.company_id

  let teQuery = supabase
    .from('time_entries')
    .select(
      'id, employee_id, worker_id, clock_in, clock_out, hours_worked, is_full_day, profile:employee_id(full_name, daily_rate, hourly_rate), worker:worker_id(full_name, daily_rate, hourly_rate), project:project_id(name)',
    )
    .eq('company_id', cid)
    .not('clock_out', 'is', null)
    .order('clock_in')
    .limit(2000)
  if (start) teQuery = teQuery.gte('clock_in', start.toISOString())
  if (end) teQuery = teQuery.lte('clock_in', end.toISOString())

  // Any time entry that's part of a finalized (paid) payroll period must
  // report its frozen rate/hours/day-type from that snapshot, never today's
  // live values — otherwise editing a rate or the company Pay System after
  // the fact would silently change an already-paid period's export.
  let finalizedQuery = supabase
    .from('payroll_period_entries')
    .select('source_time_entry_id, daily_rate, hourly_rate, hours_worked, is_full_day, project_name')
    .eq('company_id', cid)
  if (start) finalizedQuery = finalizedQuery.gte('entry_date', start.toISOString().slice(0, 10))
  if (end) finalizedQuery = finalizedQuery.lte('entry_date', end.toISOString().slice(0, 10))

  let expQuery = supabase
    .from('expenses')
    .select(
      'description, amount, expense_date, approval_status, submitted_by:submitted_by_profile_id(full_name), category:category_id(name)',
    )
    .eq('company_id', cid)
    .order('expense_date')
    .limit(1000)
  if (start) expQuery = expQuery.gte('expense_date', start.toISOString().slice(0, 10))
  if (end) expQuery = expQuery.lte('expense_date', end.toISOString().slice(0, 10))

  let milQuery = supabase
    .from('mileage_trips')
    .select(
      'trip_date, origin, destination, distance_miles, reimbursement_amount, approval_status, employee:employee_profile_id(full_name)',
    )
    .eq('company_id', cid)
    .order('trip_date')
    .limit(1000)
  if (start) milQuery = milQuery.gte('trip_date', start.toISOString().slice(0, 10))
  if (end) milQuery = milQuery.lte('trip_date', end.toISOString().slice(0, 10))

  // Manual Compensation — extra work, bonuses, corrections, and
  // production-paid subcontractor pay (no time_entries row at all). A
  // period that's already been finalized reports the frozen snapshot copy
  // instead of the live table, same reasoning as time entries above.
  let liveManualQuery = supabase
    .from('manual_compensations')
    .select('person_name, amount, compensation_date, category, description, project:project_id(name)')
    .eq('company_id', cid)
    .is('payroll_period_id', null)
  if (start) liveManualQuery = liveManualQuery.gte('compensation_date', start.toISOString().slice(0, 10))
  if (end) liveManualQuery = liveManualQuery.lte('compensation_date', end.toISOString().slice(0, 10))

  let frozenManualQuery = supabase
    .from('payroll_period_entries')
    .select('person_name, total_pay, entry_date, category, notes, project_name')
    .eq('company_id', cid)
    .eq('source_type', 'manual_compensation')
  if (start) frozenManualQuery = frozenManualQuery.gte('entry_date', start.toISOString().slice(0, 10))
  if (end) frozenManualQuery = frozenManualQuery.lte('entry_date', end.toISOString().slice(0, 10))

  const [{ data: company }, { data: rawEntries }, { data: rawExpenses }, { data: rawMileage }, { data: frozenEntries }, { data: liveManual }, { data: frozenManual }] =
    await Promise.all([
      supabase.from('companies').select('name').eq('id', cid).single(),
      teQuery,
      expQuery,
      milQuery,
      finalizedQuery,
      liveManualQuery,
      frozenManualQuery,
    ])

  type RawEntry = {
    id: string
    employee_id: string | null
    worker_id: string | null
    clock_in: string
    clock_out: string
    hours_worked: number | null
    is_full_day: boolean | null
    profile: { full_name: string; daily_rate: number | null; hourly_rate: number | null } | null
    worker: { full_name: string; daily_rate: number | null; hourly_rate: number | null } | null
    project: { name: string } | null
  }
  type FrozenEntry = {
    source_time_entry_id: string | null
    daily_rate: number
    hourly_rate: number
    hours_worked: number | null
    is_full_day: boolean | null
    project_name: string | null
  }
  const frozenById = new Map(
    ((frozenEntries ?? []) as unknown as FrozenEntry[])
      .filter(f => f.source_time_entry_id)
      .map(f => [f.source_time_entry_id as string, f]),
  )
  type RawExpense = {
    description: string
    amount: number
    expense_date: string
    approval_status: string
    submitted_by: { full_name: string } | null
    category: { name: string } | null
  }
  type RawMileage = {
    trip_date: string
    origin: string
    destination: string
    distance_miles: number
    reimbursement_amount: number
    approval_status: string
    employee: { full_name: string } | null
  }

  const entries = ((rawEntries ?? []) as unknown as RawEntry[]).map(e => {
    const frozen = frozenById.get(e.id)
    // A finalized entry reports its snapshot's rate/hours/day-type, not
    // today's live values — that's what makes a paid period permanent.
    const hoursWorkedInput = frozen ? frozen.hours_worked : (e.hours_worked != null ? Number(e.hours_worked) : null)
    const isFullDayInput = frozen ? frozen.is_full_day : e.is_full_day
    const dailyRateInput = frozen ? frozen.daily_rate : (e.profile?.daily_rate ?? e.worker?.daily_rate ?? null)
    const hourlyRateInput = frozen ? frozen.hourly_rate : (e.profile?.hourly_rate ?? e.worker?.hourly_rate ?? null)

    const hours = hoursWorkedInput != null
      ? hoursWorkedInput
      : (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 3600000
    const calc = calcEntryPay({
      clock_in: e.clock_in,
      clock_out: e.clock_out,
      hours_worked: hoursWorkedInput,
      is_full_day: isFullDayInput,
      daily_rate: dailyRateInput,
      hourly_rate: hourlyRateInput,
    })
    return {
      full_name: e.profile?.full_name ?? e.worker?.full_name ?? '—',
      date: e.clock_in.slice(0, 10),
      hours: Math.round(hours * 100) / 100,
      daily_rate: calc.dailyRate,
      hourly_rate: calc.hourlyRate,
      is_full_day: isFullDayInput,
      project: frozen ? (frozen.project_name ?? e.project?.name ?? null) : (e.project?.name ?? null),
    }
  })

  const expenses = ((rawExpenses ?? []) as unknown as RawExpense[]).map(e => ({
    employee_name: e.submitted_by?.full_name ?? '—',
    description: e.description,
    amount: Number(e.amount),
    date: e.expense_date,
    category: e.category?.name ?? null,
    approval_status: e.approval_status,
  }))

  const mileage = ((rawMileage ?? []) as unknown as RawMileage[]).map(m => ({
    employee_name: m.employee?.full_name ?? '—',
    date: m.trip_date,
    origin: m.origin,
    destination: m.destination,
    miles: Number(m.distance_miles),
    amount: Number(m.reimbursement_amount),
    approval_status: m.approval_status,
  }))

  type LiveManual = {
    person_name: string
    amount: number
    compensation_date: string
    category: string
    description: string
    project: { name: string } | null
  }
  type FrozenManual = {
    person_name: string
    total_pay: number
    entry_date: string
    category: string | null
    notes: string | null
    project_name: string | null
  }
  const manualCompensations = [
    ...((liveManual ?? []) as unknown as LiveManual[]).map(m => ({
      full_name: m.person_name,
      date: m.compensation_date,
      category: m.category,
      description: m.description,
      project: m.project?.name ?? null,
      amount: Number(m.amount),
    })),
    ...((frozenManual ?? []) as unknown as FrozenManual[]).map(m => ({
      full_name: m.person_name,
      date: m.entry_date,
      category: m.category ?? 'extra_work',
      description: m.notes ?? '',
      project: m.project_name,
      amount: Number(m.total_pay),
    })),
  ]

  return Response.json({
    company_name: (company as { name: string } | null)?.name ?? 'Company',
    period_label: buildPeriodLabel(period, start, end),
    period_start: start?.toISOString().slice(0, 10) ?? null,
    period_end: end?.toISOString().slice(0, 10) ?? null,
    entries,
    expenses,
    mileage,
    manualCompensations,
  })
}
