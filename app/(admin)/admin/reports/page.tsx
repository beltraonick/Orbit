'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import type { ExportData } from '@/lib/exports/exportPayrollXLSX'

interface ReportRow {
  employee_id: string
  full_name: string
  email: string
  totalEntries: number
  totalHours: number
  regularHours: number
  overtimeHours: number
  approvedHours: number
  pendingHours: number
}

interface EntryRow {
  id: string
  employee_id: string
  clock_in: string
  clock_out: string | null
  city: string | null
  state: string | null
  approval_status: string | null
  project: { name: string } | null
  profile: { full_name: string } | null
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
  return <Badge variant="default">Draft</Badge>
}

// ─── Payroll Tab ──────────────────────────────────────────────────────────────

function PayrollReport({ period }: { period: string }) {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const [rows, setRows] = useState<ReportRow[]>([])
  const [entries, setEntries] = useState<EntryRow[]>([])
  const [profiles, setProfiles] = useState<{ id: string; hourly_rate: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'summary' | 'detail'>('summary')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const start = getPeriodStart(period)
    const end = getPeriodEnd(period)

    let query = supabase
      .from('time_entries')
      .select('id, employee_id, clock_in, clock_out, city, state, approval_status, project:project_id(name), profile:employee_id(full_name, email)')
      .eq('company_id', companyId)
      .order('clock_in', { ascending: false })
      .limit(500)

    if (start) query = query.gte('clock_in', start.toISOString())
    if (end) query = query.lte('clock_in', end.toISOString())

    const [{ data: ents }, { data: profs }] = await Promise.all([
      query,
      supabase.from('profiles').select('id, full_name, email, hourly_rate').eq('company_id', companyId),
    ])

    const fetchedEntries = (ents ?? []) as unknown as EntryRow[]
    setEntries(fetchedEntries)
    setProfiles((profs ?? []) as { id: string; hourly_rate: number }[])

    const empMap = new Map<string, ReportRow>()
    for (const e of fetchedEntries) {
      if (!e.profile) continue
      if (!empMap.has(e.employee_id)) {
        empMap.set(e.employee_id, {
          employee_id: e.employee_id,
          full_name: (e.profile as unknown as { full_name: string }).full_name ?? '',
          email: (e.profile as unknown as { email: string }).email ?? '',
          totalEntries: 0, totalHours: 0, regularHours: 0,
          overtimeHours: 0, approvedHours: 0, pendingHours: 0,
        })
      }
      const row = empMap.get(e.employee_id)!
      row.totalEntries++
      if (e.clock_out) {
        const h = (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 3600000
        row.totalHours += h
        const status = e.approval_status ?? 'approved'
        if (status === 'approved') row.approvedHours += h
        if (status === 'pending') row.pendingHours += h
      }
    }

    const allRows = Array.from(empMap.values())
    for (const row of allRows) {
      row.regularHours = Math.min(row.totalHours, 40)
      row.overtimeHours = Math.max(row.totalHours - 40, 0)
    }
    setRows(allRows.sort((a, b) => b.totalHours - a.totalHours))
    setLoading(false)
  }, [period, companyId])

  useEffect(() => { load() }, [load])

  const rateMap = new Map(profiles.map(p => [p.id, Number(p.hourly_rate)]))
  const grandHours = rows.reduce((s, r) => s + r.totalHours, 0)
  const grandPay = rows.reduce((s, r) => {
    const rate = rateMap.get(r.employee_id) ?? 0
    return s + r.regularHours * rate + r.overtimeHours * rate * 1.5
  }, 0)

  return (
    <>
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card>
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t('admin.reports.employees')}</p>
            <p className="text-2xl font-bold text-primary">{rows.length}</p>
          </Card>
          <Card>
            <p className="text-xs text-secondary uppercase tracking-wide mb-1">{t('admin.reports.totalHours')}</p>
            <p className="text-2xl font-bold text-primary">{grandHours.toFixed(1)}h</p>
          </Card>
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
                    <th className="text-right px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.regular')}</th>
                    <th className="text-right px-4 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.overtime')}</th>
                    <th className="text-right px-5 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.estPay')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {rows.map(r => {
                    const rate = rateMap.get(r.employee_id) ?? 0
                    const pay = r.regularHours * rate + r.overtimeHours * rate * 1.5
                    return (
                      <tr key={r.employee_id} className="hover:bg-surface-elevated/40 transition-colors">
                        <td className="px-5 py-3">
                          <p className="font-medium text-primary">{r.full_name}</p>
                          <p className="text-xs text-tertiary">{r.email}</p>
                        </td>
                        <td className="text-right px-4 py-3 text-secondary tabular-nums">{r.totalEntries}</td>
                        <td className="text-right px-4 py-3 text-secondary tabular-nums">{r.regularHours.toFixed(1)}h</td>
                        <td className="text-right px-4 py-3 tabular-nums">
                          {r.overtimeHours > 0
                            ? <span className="text-amber">{r.overtimeHours.toFixed(1)}h</span>
                            : <span className="text-tertiary">—</span>}
                        </td>
                        <td className="text-right px-5 py-3 font-semibold text-primary tabular-nums">{fmt(pay)}</td>
                      </tr>
                    )
                  })}
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
                    <th className="text-right px-5 py-3 text-xs font-medium text-tertiary uppercase tracking-wide">{t('admin.reports.hours')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {entries.map(e => {
                    const hours = e.clock_out
                      ? (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 3600000
                      : null
                    return (
                      <tr key={e.id} className="hover:bg-surface-elevated/40 transition-colors">
                        <td className="px-5 py-3 font-medium text-primary whitespace-nowrap">
                          {(e.profile as unknown as { full_name: string } | null)?.full_name ?? '—'}
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

  const totalAmount = expenses.reduce((s, e) => s + (e.amount ?? 0), 0)
  const approvedAmount = expenses.filter(e => e.approval_status === 'approved').reduce((s, e) => s + (e.amount ?? 0), 0)
  const pendingCount = expenses.filter(e => ['submitted', 'needs_review', 'draft'].includes(e.approval_status)).length

  return (
    <>
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
                {expenses.map(e => (
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

  const totalMiles = trips.reduce((s, t) => s + (t.distance_miles ?? 0), 0)
  const totalReimbursement = trips.reduce((s, t) => s + (t.reimbursement_amount ?? 0), 0)
  const approvedReimbursement = trips.filter(t => t.approval_status === 'approved').reduce((s, t) => s + (t.reimbursement_amount ?? 0), 0)

  return (
    <>
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
                {trips.map(trip => (
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
  const [period, setPeriod] = useState('month')
  const [tab, setTab] = useState<ReportTab>('payroll')
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
