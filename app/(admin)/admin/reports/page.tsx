'use client'

import { usePersistentState, oneOf } from '@/lib/use-persistent-state'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { DayTypeBadge } from '@/components/ui/DayTypeBadge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import type { ExportData } from '@/lib/exports/exportPayrollXLSX'
import { calcEntryPay } from '@/lib/payroll-calc'
import type { PeriodType } from '@/lib/employee-period'

interface ReportRow {
  personId: string
  full_name: string
  email: string
  payMode: 'daily' | 'hourly'
  totalEntries: number
  totalHours: number
  regularHours: number
  overtimeHours: number
  totalDays: number
  totalPay: number
  overtimePay: number
  /** Manual compensation (extra work, bonus, correction, production) — already included in totalPay. */
  manualPay: number
}

interface EntryRow {
  id: string
  employee_id: string | null
  worker_id: string | null
  clock_in: string
  clock_out: string | null
  hours_worked: number | null
  is_full_day: boolean | null
  city: string | null
  state: string | null
  approval_status: string | null
  project: { name: string } | null
  profile: { full_name: string; email: string; daily_rate: number | null; hourly_rate: number | null } | null
  worker: { full_name: string; daily_rate: number | null; hourly_rate: number | null } | null
}

interface ExpenseRow {
  id: string
  description: string
  amount: number
  expense_date: string
  expense_type: string
  approval_status: string
  category: { name: string } | null
  project: { name: string } | null
  submitted_by: { full_name: string } | null
}

interface MileageRow {
  id: string
  trip_date: string
  origin: string
  destination: string
  distance_miles: number
  reimbursement_amount: number
  approval_status: string
  purpose: string | null
  employee: { full_name: string } | null
}

const fmt = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function usePeriodOptions() {
  const { t } = useTranslation()
  return [
    { value: 'week', label: t('common.thisWeek') },
    { value: 'last_week', label: t('admin.reports.periodLastWeek') },
    { value: 'month', label: t('common.thisMonth') },
    { value: 'last_month', label: t('admin.reports.periodLastMonth') },
    { value: 'all', label: t('admin.reports.periodAllTime') },
  ]
}

function getPeriodStart(p: string): Date | null {
  const now = new Date()
  if (p === 'week') {
    const d = new Date(now); d.setDate(now.getDate() - now.getDay()); d.setHours(0, 0, 0, 0); return d
  }
  if (p === 'last_week') {
    const d = new Date(now); d.setDate(now.getDate() - now.getDay() - 7); d.setHours(0, 0, 0, 0); return d
  }
  if (p === 'month') {
    return new Date(now.getFullYear(), now.getMonth(), 1)
  }
  if (p === 'last_month') {
    return new Date(now.getFullYear(), now.getMonth() - 1, 1)
  }
  return null
}

function getPeriodEnd(p: string): Date | null {
  const now = new Date()
  if (p === 'last_week') {
    const d = new Date(now); d.setDate(now.getDate() - now.getDay() - 1); d.setHours(23, 59, 59, 999); return d
  }
  if (p === 'last_month') {
    return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
  }
  return null
}

function statusBadge(status: string) {
  if (status === 'approved') return <Badge variant="green">Approved</Badge>
  if (status === 'rejected') return <Badge variant="red">Rejected</Badge>
  if (status === 'needs_review') return <Badge variant="amber">Needs Review</Badge>
  if (status === 'submitted') return <Badge variant="blue">Submitted</Badge>
  if (status === 'paid') return <Badge variant="green">Paid</Badge>
  if (status === 'draft') return <Badge variant="default">Draft</Badge>
  return <Badge variant="default">{status || 'Unknown'}</Badge>
}

// ─── Payroll Tab ──────────────────────────────────────────────────────────────

function PayrollReport({ period }: { period: string }) {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const [rows, setRows] = useState<ReportRow[]>([])
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = usePersistentState<'summary' | 'detail'>('reports.view', 'summary', oneOf(['summary', 'detail'] as const))
  const [homePeriodType, setHomePeriodType] = useState<PeriodType>('biweekly')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const start = getPeriodStart(period)
    const end = getPeriodEnd(period)

    supabase
      .from('company_document_settings')
      .select('home_period_type')
      .eq('company_id', companyId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.home_period_type) setHomePeriodType(data.home_period_type as PeriodType)
      })

    let query = supabase
      .from('time_entries')
      .select(`
        id, employee_id, worker_id, clock_in, clock_out, is_full_day,
        city, state, approval_status,
        project:project_id(name),
        profile:employee_id(full_name, email, daily_rate, hourly_rate),
        worker:worker_id(full_name, daily_rate, hourly_rate)
      `)
      .eq('company_id', companyId)
      .not('clock_out', 'is', null)
      .order('clock_in', { ascending: false })
      .limit(500)

    if (start) query = query.gte('clock_in', start.toISOString())
    if (end) query = query.lte('clock_in', end.toISOString())

    // A finalized (paid) period reports its frozen rate/hours/day-type, not
    // today's live values, so this report can't drift from what was actually
    // paid once rates or the company Pay System change later.
    let frozenQuery = supabase
      .from('payroll_period_entries')
      .select('source_time_entry_id, daily_rate, hourly_rate, hours_worked, is_full_day')
      .eq('company_id', companyId)
    if (start) frozenQuery = frozenQuery.gte('entry_date', start.toISOString().slice(0, 10))
    if (end) frozenQuery = frozenQuery.lte('entry_date', end.toISOString().slice(0, 10))

    // Manual compensation, same sources as the XLSX export and Payroll:
    // the live table for unpaid periods, the frozen snapshot once paid.
    let liveManualQuery = supabase
      .from('manual_compensations')
      .select('person_id, person_name, amount')
      .eq('company_id', companyId)
      .is('payroll_period_id', null)
    if (start) liveManualQuery = liveManualQuery.gte('compensation_date', start.toISOString().slice(0, 10))
    if (end) liveManualQuery = liveManualQuery.lte('compensation_date', end.toISOString().slice(0, 10))
    let frozenManualQuery = supabase
      .from('payroll_period_entries')
      .select('person_id, person_name, total_pay')
      .eq('company_id', companyId)
      .eq('source_type', 'manual_compensation')
    if (start) frozenManualQuery = frozenManualQuery.gte('entry_date', start.toISOString().slice(0, 10))
    if (end) frozenManualQuery = frozenManualQuery.lte('entry_date', end.toISOString().slice(0, 10))

    const [{ data: ents }, { data: frozenEntries }, { data: liveManual }, { data: frozenManual }] =
      await Promise.all([query, frozenQuery, liveManualQuery, frozenManualQuery])
    const fetchedEntries = (ents ?? []) as unknown as EntryRow[]
    setEntries(fetchedEntries)

    type FrozenEntry = {
      source_time_entry_id: string | null
      daily_rate: number
      hourly_rate: number
      hours_worked: number | null
      is_full_day: boolean | null
    }
    const frozenById = new Map(
      ((frozenEntries ?? []) as unknown as FrozenEntry[])
        .filter(f => f.source_time_entry_id)
        .map(f => [f.source_time_entry_id as string, f]),
    )

    // Same calcEntryPay() the Admin Payroll page and XLSX export use — this
    // report can't disagree with those on what a given entry is worth.
    const empMap = new Map<string, ReportRow>()
    for (const e of fetchedEntries) {
      const personId = e.employee_id ?? e.worker_id
      if (!personId) continue
      const frozen = frozenById.get(e.id)
      const calc = calcEntryPay({
        clock_in: e.clock_in,
        clock_out: e.clock_out,
        hours_worked: frozen ? frozen.hours_worked : e.hours_worked,
        is_full_day: frozen ? frozen.is_full_day : e.is_full_day,
        daily_rate: frozen ? frozen.daily_rate : (e.profile?.daily_rate ?? e.worker?.daily_rate ?? null),
        hourly_rate: frozen ? frozen.hourly_rate : (e.profile?.hourly_rate ?? e.worker?.hourly_rate ?? null),
      })

      if (!empMap.has(personId)) {
        empMap.set(personId, {
          personId,
          full_name: e.profile?.full_name ?? e.worker?.full_name ?? '—',
          email: e.profile?.email ?? '',
          payMode: calc.payMode,
          totalEntries: 0, totalHours: 0, regularHours: 0,
          overtimeHours: 0, totalDays: 0, totalPay: 0, overtimePay: 0, manualPay: 0,
        })
      }
      const row = empMap.get(personId)!
      row.totalEntries++
      const hours = calc.hoursWorked ?? 0
      row.totalHours += hours
      row.overtimeHours += calc.overtimeHours
      row.regularHours += Math.max(hours - calc.overtimeHours, 0)
      row.totalDays += calc.payMode === 'daily' ? (calc.fullDay ? 1 : 0.5) : 0
      row.totalPay += calc.totalPay + calc.overtimePay
      row.overtimePay += calc.overtimePay
    }

    type ManualRow = { person_id: string; person_name: string; amount?: number; total_pay?: number }
    const manualRows = [
      ...((liveManual ?? []) as unknown as ManualRow[]).map(m => ({ ...m, value: Number(m.amount) })),
      ...((frozenManual ?? []) as unknown as ManualRow[]).map(m => ({ ...m, value: Number(m.total_pay) })),
    ]
    for (const m of manualRows) {
      if (!m.person_id || !Number.isFinite(m.value)) continue
      if (!empMap.has(m.person_id)) {
        // Someone paid only by manual compensation in this period.
        empMap.set(m.person_id, {
          personId: m.person_id,
          full_name: m.person_name || '—',
          email: '',
          payMode: 'daily',
          totalEntries: 0, totalHours: 0, regularHours: 0,
          overtimeHours: 0, totalDays: 0, totalPay: 0, overtimePay: 0, manualPay: 0,
        })
      }
      const row = empMap.get(m.person_id)!
      row.manualPay += m.value
      row.totalPay += m.value
    }

    setRows(Array.from(empMap.values()).sort((a, b) => b.totalPay - a.totalPay))
    setLoading(false)
  }, [period, companyId])

  useEffect(() => { load() }, [load])

  // Days and hours are kept separate (per-person pay mode) instead of a
  // single "Total Hours" figure that has no meaning for a Daily-mode crew —
  // same rule admin/time and calcEntryPay() use.
  const grandDays = rows.reduce((s, r) => s + r.totalDays, 0)
  const grandHours = rows.reduce((s, r) => s + (r.payMode === 'hourly' ? r.totalHours : 0), 0)
  const grandPay = rows.reduce((s, r) => s + r.totalPay, 0)
  const allDaily = rows.length > 0 && rows.every(r => r.payMode === 'daily')
  const hasManual = rows.some(r => r.manualPay !== 0)

  return (
    <>
      {!loading && rows.length > 0 && (
        <Card className="mb-6 bg-brand/5 border-brand/20">
          <p className="text-sm font-semibold text-primary">
            {t(`admin.reports.periodLabel_${homePeriodType}`)}
          </p>
          <p className="text-xs text-secondary mt-1">
            {t('admin.reports.periodExplainer')}
          </p>
        </Card>
      )}

      {!loading && rows.length > 0 && (
        <div className={`grid grid-cols-2 gap-3 mb-6 ${grandDays > 0 && grandHours > 0 ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
          <Card>
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t('admin.reports.employees')}</p>
            <p className="text-2xl font-bold text-primary">{rows.length}</p>
          </Card>
          {grandDays > 0 && (
            <Card>
              <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t('admin.reports.totalDays')}</p>
              <p className="text-2xl font-bold text-primary">{grandDays % 1 === 0 ? grandDays : grandDays.toFixed(1)}</p>
            </Card>
          )}
          {grandHours > 0 && (
            <Card>
              <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t('admin.reports.totalHours')}</p>
              <p className="text-2xl font-bold text-primary">{grandHours.toFixed(1)}h</p>
            </Card>
          )}
          <Card>
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t('admin.reports.estPayroll')}</p>
            <p className="text-2xl font-bold text-primary">{fmt(grandPay)}</p>
          </Card>
          <Card>
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t('admin.reports.entries')}</p>
            <p className="text-2xl font-bold text-primary">{entries.length}</p>
          </Card>
        </div>
      )}

      <div className="flex gap-1 mb-4">
        {(['summary', 'detail'] as const).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={['px-3 py-2 text-xs font-medium rounded-button transition-colors',
              view === v ? 'bg-brand text-white' : 'text-secondary hover:text-primary bg-surface-elevated border border-[var(--border)]',
            ].join(' ')}>
            {v === 'summary' ? t('admin.reports.viewSummary') : t('admin.reports.viewDetail')}
          </button>
        ))}
      </div>

      {view === 'summary' ? (
        <Card padding="none">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-semibold text-primary">{t('admin.reports.byEmployee')}</h2>
          </div>
          {loading ? (
            <p className="px-5 py-10 text-sm text-secondary text-center">{t('common.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-10 text-sm text-secondary text-center">{t('admin.reports.noDataPeriod')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left px-5 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.tableEmployee')}</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.entries')}</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">
                      {allDaily ? t('admin.reports.days') : t('admin.reports.regular')}
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.overtime')}</th>
                    {hasManual && (
                      <th className="text-right px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.manual')}</th>
                    )}
                    <th className="text-right px-5 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.estPay')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {rows.map(r => (
                    <tr key={r.personId} className="hover:bg-surface-elevated/40 transition-colors">
                      <td className="px-5 py-3">
                        <p className="font-medium text-primary">{r.full_name}</p>
                        <p className="text-xs text-tertiary">{r.email}</p>
                      </td>
                      <td className="text-right px-4 py-3 text-secondary tabular-nums">{r.totalEntries}</td>
                      <td className="text-right px-4 py-3 text-secondary tabular-nums">
                        {r.payMode === 'daily'
                          ? (r.totalDays % 1 === 0 ? r.totalDays : r.totalDays.toFixed(1))
                          : `${r.regularHours.toFixed(1)}h`}
                      </td>
                      <td className="text-right px-4 py-3 tabular-nums">
                        {r.overtimeHours > 0
                          ? <span className="text-amber">{r.overtimeHours.toFixed(1)}h</span>
                          : <span className="text-tertiary">—</span>}
                      </td>
                      {hasManual && (
                        <td className="text-right px-4 py-3 tabular-nums text-secondary">
                          {r.manualPay !== 0 ? fmt(r.manualPay) : <span className="text-tertiary">—</span>}
                        </td>
                      )}
                      <td className="text-right px-5 py-3 font-semibold text-primary tabular-nums">{fmt(r.totalPay)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card padding="none">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <h2 className="text-sm font-semibold text-primary">{t('admin.reports.allEntries')}</h2>
          </div>
          {loading ? (
            <p className="px-5 py-10 text-sm text-secondary text-center">{t('common.loading')}</p>
          ) : entries.length === 0 ? (
            <p className="px-5 py-10 text-sm text-secondary text-center">{t('admin.reports.noEntriesPeriod')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)]">
                    <th className="text-left px-5 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.tableEmployee')}</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.date')}</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.time')}</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.location')}</th>
                    <th className="text-left px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.dayType')}</th>
                    <th className="text-right px-5 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.hours')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {entries.map(e => {
                    const hours = e.hours_worked != null
                      ? Number(e.hours_worked)
                      : e.clock_out
                        ? (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 3600000
                        : null
                    const rates = e.profile ?? e.worker
                    const calc = rates && e.clock_out
                      ? calcEntryPay({
                          clock_in: e.clock_in,
                          clock_out: e.clock_out,
                          hours_worked: e.hours_worked != null ? Number(e.hours_worked) : null,
                          is_full_day: e.is_full_day,
                          daily_rate: rates.daily_rate,
                          hourly_rate: rates.hourly_rate,
                        })
                      : null
                    return (
                      <tr key={e.id} className="hover:bg-surface-elevated/40 transition-colors">
                        <td className="px-5 py-3 font-medium text-primary whitespace-nowrap">
                          {e.profile?.full_name ?? e.worker?.full_name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-secondary whitespace-nowrap">
                          {new Date(e.clock_in).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </td>
                        <td className="px-4 py-3 text-secondary whitespace-nowrap tabular-nums">
                          {new Date(e.clock_in).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                          {e.clock_out && ` → ${new Date(e.clock_out).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`}
                        </td>
                        <td className="px-4 py-3 text-secondary text-xs">
                          {[e.city, e.state].filter(Boolean).join(', ') || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {calc?.payMode === 'daily' ? (
                            <DayTypeBadge
                              fullDay={calc.fullDay}
                              label={calc.fullDay ? t('admin.time.fullDay') : t('admin.time.halfDay')}
                            />
                          ) : (
                            <span className="text-tertiary text-xs">—</span>
                          )}
                        </td>
                        <td className="text-right px-5 py-3 tabular-nums">
                          {hours != null
                            ? <span className="font-semibold text-primary">{hours.toFixed(2)}h</span>
                            : <span className="text-green text-xs">{t('common.active')}</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  )
}

// ─── Expenses Tab ─────────────────────────────────────────────────────────────

function ExpensesReport({ period }: { period: string }) {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [searchText, setSearchText] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const start = getPeriodStart(period)
    const end = getPeriodEnd(period)

    let query = supabase
      .from('expenses')
      .select('id, description, amount, expense_date, expense_type, approval_status, category:category_id(name), project:project_id(name), submitted_by:submitted_by_profile_id(full_name)')
      .eq('company_id', companyId)
      .order('expense_date', { ascending: false })
      .limit(500)

    if (start) query = query.gte('expense_date', start.toISOString().slice(0, 10))
    if (end) query = query.lte('expense_date', end.toISOString().slice(0, 10))

    const { data } = await query
    setExpenses((data ?? []) as unknown as ExpenseRow[])
    setLoading(false)
  }, [period, companyId])

  useEffect(() => { load() }, [load])

  const employeeNames = Array.from(
    new Set(expenses.map(e => e.submitted_by?.full_name).filter((n): n is string => !!n))
  ).sort()

  const filtered = expenses.filter(e => {
    if (employeeFilter && e.submitted_by?.full_name !== employeeFilter) return false
    if (searchText && !e.description.toLowerCase().includes(searchText.toLowerCase())) return false
    return true
  })

  const totalAmount = filtered.reduce((s, e) => s + (e.amount ?? 0), 0)
  const approvedAmount = filtered.filter(e => e.approval_status === 'approved').reduce((s, e) => s + (e.amount ?? 0), 0)
  const pendingCount = filtered.filter(e => ['submitted', 'needs_review', 'draft'].includes(e.approval_status)).length

  return (
    <>
      {!loading && expenses.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          <input
            type="text"
            value={searchText}
            onChange={ev => setSearchText(ev.target.value)}
            placeholder="Search by store / description…"
            className="flex-1 min-w-[180px] h-10 rounded-input bg-surface-elevated border border-[var(--border)] px-3 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60 transition-colors"
          />
          <select
            value={employeeFilter}
            onChange={ev => setEmployeeFilter(ev.target.value)}
            className="h-10 rounded-input bg-surface-elevated border border-[var(--border)] px-3 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60 transition-colors"
          >
            <option value="">All employees</option>
            {employeeNames.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      )}

      {!loading && expenses.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          <Card>
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Total Expenses</p>
            <p className="text-2xl font-bold text-primary">{fmt(totalAmount)}</p>
          </Card>
          <Card>
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Approved</p>
            <p className="text-2xl font-bold text-green">{fmt(approvedAmount)}</p>
          </Card>
          <Card>
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Pending Review</p>
            <p className="text-2xl font-bold text-amber">{pendingCount}</p>
          </Card>
        </div>
      )}

      <Card padding="none">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-primary">Expense Submissions</h2>
        </div>
        {loading ? (
          <p className="px-5 py-10 text-sm text-secondary text-center">{t('common.loading')}</p>
        ) : expenses.length === 0 ? (
          <p className="px-5 py-10 text-sm text-secondary text-center">No expenses for this period.</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-sm text-secondary text-center">No expenses match this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Employee</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Category</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map(e => (
                  <tr key={e.id} className="hover:bg-surface-elevated/40 transition-colors">
                    <td className="px-5 py-3 font-medium text-primary whitespace-nowrap">
                      {(e.submitted_by as unknown as { full_name: string } | null)?.full_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-secondary max-w-[200px] truncate">{e.description}</td>
                    <td className="px-4 py-3 text-secondary whitespace-nowrap">
                      {(e.category as unknown as { name: string } | null)?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-secondary whitespace-nowrap">{e.expense_date}</td>
                    <td className="px-4 py-3">{statusBadge(e.approval_status)}</td>
                    <td className="text-right px-5 py-3 font-semibold text-primary tabular-nums">{fmt(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

// ─── Mileage Tab ──────────────────────────────────────────────────────────────

function MileageReport({ period }: { period: string }) {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const [trips, setTrips] = useState<MileageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [employeeFilter, setEmployeeFilter] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const start = getPeriodStart(period)
    const end = getPeriodEnd(period)

    let query = supabase
      .from('mileage_trips')
      .select('id, trip_date, origin, destination, distance_miles, reimbursement_amount, approval_status, purpose, employee:employee_profile_id(full_name)')
      .eq('company_id', companyId)
      .order('trip_date', { ascending: false })
      .limit(500)

    if (start) query = query.gte('trip_date', start.toISOString().slice(0, 10))
    if (end) query = query.lte('trip_date', end.toISOString().slice(0, 10))

    const { data } = await query
    setTrips((data ?? []) as unknown as MileageRow[])
    setLoading(false)
  }, [period, companyId])

  useEffect(() => { load() }, [load])

  const employeeNames = Array.from(
    new Set(trips.map(t => t.employee?.full_name).filter((n): n is string => !!n))
  ).sort()

  const filtered = employeeFilter ? trips.filter(t => t.employee?.full_name === employeeFilter) : trips

  const totalMiles = filtered.reduce((s, t) => s + (t.distance_miles ?? 0), 0)
  const totalReimbursement = filtered.reduce((s, t) => s + (t.reimbursement_amount ?? 0), 0)
  const approvedReimbursement = filtered.filter(t => t.approval_status === 'approved').reduce((s, t) => s + (t.reimbursement_amount ?? 0), 0)

  return (
    <>
      {!loading && trips.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-4">
          <select
            value={employeeFilter}
            onChange={ev => setEmployeeFilter(ev.target.value)}
            className="h-10 rounded-input bg-surface-elevated border border-[var(--border)] px-3 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60 transition-colors"
          >
            <option value="">All employees</option>
            {employeeNames.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      )}

      {!loading && trips.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          <Card>
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Total Miles</p>
            <p className="text-2xl font-bold text-primary">{totalMiles.toFixed(1)} mi</p>
          </Card>
          <Card>
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Total Reimbursement</p>
            <p className="text-2xl font-bold text-primary">{fmt(totalReimbursement)}</p>
          </Card>
          <Card>
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">Approved</p>
            <p className="text-2xl font-bold text-green">{fmt(approvedReimbursement)}</p>
          </Card>
        </div>
      )}

      <Card padding="none">
        <div className="px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-sm font-semibold text-primary">Mileage Trips</h2>
        </div>
        {loading ? (
          <p className="px-5 py-10 text-sm text-secondary text-center">{t('common.loading')}</p>
        ) : trips.length === 0 ? (
          <p className="px-5 py-10 text-sm text-secondary text-center">No mileage trips for this period.</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-sm text-secondary text-center">No trips match this filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Employee</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Route</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Miles</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">Reimbursement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filtered.map(trip => (
                  <tr key={trip.id} className="hover:bg-surface-elevated/40 transition-colors">
                    <td className="px-5 py-3 font-medium text-primary whitespace-nowrap">
                      {(trip.employee as unknown as { full_name: string } | null)?.full_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-secondary whitespace-nowrap">{trip.trip_date}</td>
                    <td className="px-4 py-3 text-secondary max-w-[200px]">
                      <p className="truncate text-xs">{trip.origin} → {trip.destination}</p>
                      {trip.purpose && <p className="text-xs text-tertiary truncate">{trip.purpose}</p>}
                    </td>
                    <td className="px-4 py-3">{statusBadge(trip.approval_status)}</td>
                    <td className="text-right px-4 py-3 text-secondary tabular-nums">{(trip.distance_miles ?? 0).toFixed(1)}</td>
                    <td className="text-right px-5 py-3 font-semibold text-primary tabular-nums">{fmt(trip.reimbursement_amount ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type ReportTab = 'payroll' | 'expenses' | 'mileage'

export default function ReportsPage() {
  const { t } = useTranslation()
  const PERIOD_OPTIONS = usePeriodOptions()
  const [period, setPeriod] = usePersistentState<string>('reports.period', 'all', oneOf(['week', 'last_week', 'month', 'last_month', 'all'] as const))
  const [tab, setTab] = usePersistentState<ReportTab>('reports.tab', 'payroll', oneOf(['payroll', 'expenses', 'mileage'] as const))
  const [exportingXLSX, setExportingXLSX] = useState(false)

  function printPage() { window.print() }

  async function handleExportXLSX() {
    setExportingXLSX(true)
    try {
      const res = await fetch(`/api/reports/export?period=${period}`)
      if (!res.ok) throw new Error('Failed to fetch export data')
      const data: ExportData = await res.json()
      const { exportPayrollXLSX } = await import('@/lib/exports/exportPayrollXLSX')
      await exportPayrollXLSX(data)
    } catch (err) {
      console.error('XLSX export failed:', err)
      window.alert('Could not export the spreadsheet. Please try again.')
    } finally {
      setExportingXLSX(false)
    }
  }

  const TABS: { key: ReportTab; label: string }[] = [
    { key: 'payroll', label: t('admin.reports.title') },
    { key: 'expenses', label: 'Expenses' },
    { key: 'mileage', label: 'Mileage' },
  ]

  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      <div className="mb-6 md:mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{t('admin.reports.title')}</h1>
          <p className="text-sm text-secondary mt-1">{t('admin.reports.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-40">
            <Select
              options={PERIOD_OPTIONS}
              value={period}
              onChange={e => setPeriod(e.target.value)}
            />
          </div>
          <button
            onClick={handleExportXLSX}
            disabled={exportingXLSX}
            className="px-3 py-2 rounded-button border border-[var(--border)] text-xs font-medium text-secondary hover:text-primary hover:bg-surface-elevated transition-colors disabled:opacity-50"
          >
            {exportingXLSX ? 'Exporting…' : 'Export XLSX'}
          </button>
          <a
            href={`/admin/reports/payroll-receipt?period=${period}`}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 rounded-button border border-[var(--border)] text-xs font-medium text-secondary hover:text-primary hover:bg-surface-elevated transition-colors"
          >
            Payment Receipt (PDF)
          </a>
          <a
            href="/admin/reports/task-report"
            className="px-3 py-2 rounded-button border border-[var(--border)] text-xs font-medium text-secondary hover:text-primary hover:bg-surface-elevated transition-colors"
          >
            Relatório de Tarefas (PDF)
          </a>
          <button
            onClick={printPage}
            className="px-3 py-2 rounded-button border border-[var(--border)] text-xs font-medium text-secondary hover:text-primary hover:bg-surface-elevated transition-colors"
          >
            {t('admin.reports.print')}
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-[var(--border)]">
        {TABS.map(tb => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={[
              'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === tb.key
                ? 'text-brand border-brand'
                : 'text-secondary border-transparent hover:text-primary',
            ].join(' ')}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'payroll' && <PayrollReport period={period} />}
      {tab === 'expenses' && <ExpensesReport period={period} />}
      {tab === 'mileage' && <MileageReport period={period} />}
    </div>
  )
}
