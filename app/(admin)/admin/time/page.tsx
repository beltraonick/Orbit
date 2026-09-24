'use client'

import { writeFailed } from '@/lib/write-feedback'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { DayTypeBadge } from '@/components/ui/DayTypeBadge'
import { Input } from '@/components/ui/Input'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { createManualTimeEntry, supervisorClockOut } from '@/app/actions/workerActions'
import { TeamClockIn } from '@/app/(employee)/projects/[id]/TeamClockIn'
import { calcEntryPay } from '@/lib/payroll-calc'
import { getPayPeriodRange, getPreviousPayPeriodRange, loadCompanyPeriodSettings, type CompanyPeriodSettings } from '@/lib/employee-period'
import { DEFAULT_CLOCK_WINDOW, zonedTimeToUtc, type ClockWindowSettings } from '@/lib/clock-window'
import type { Locale } from '@/lib/i18n/translate'

interface TimeEntry {
  id: string
  employee_id: string | null
  worker_id: string | null
  project_id: string | null
  clock_in: string
  clock_out: string | null
  city: string | null
  state: string | null
  notes: string | null
  is_full_day: boolean | null
  hours_worked: number | null
  approval_status: string | null
  clocked_by_profile_id: string | null
  project: { name: string } | null
  profile: { full_name: string; email: string; daily_rate: number | null; hourly_rate: number | null } | null
  worker: { full_name: string; daily_rate: number | null; hourly_rate: number | null } | null
  clocked_by: { full_name: string } | null
}

const ENTRY_SELECT = `
  id, employee_id, worker_id, project_id, clock_in, clock_out,
  city, state, notes, is_full_day, approval_status,
  clocked_by_profile_id,
  project:project_id(name),
  profile:employee_id(full_name, email, daily_rate, hourly_rate),
  worker:worker_id(full_name, daily_rate, hourly_rate),
  clocked_by:clocked_by_profile_id(full_name)
`

// Pay mode (Daily vs Hourly) is per-person, same rule calcEntryPay() uses —
// so this page never mislabels an hourly person's shift as a "Full Day".
function entryCalc(e: TimeEntry) {
  if (!e.clock_out) return null
  const rates = e.profile ?? e.worker
  if (!rates) return null
  return calcEntryPay({
    clock_in: e.clock_in,
    clock_out: e.clock_out,
    hours_worked: e.hours_worked != null ? Number(e.hours_worked) : null,
    is_full_day: e.is_full_day,
    daily_rate: rates.daily_rate,
    hourly_rate: rates.hourly_rate,
  })
}

function filterOptions(t: (key: string) => string) {
  return [
    { value: 'all', label: t('admin.time.allTime') },
    { value: 'current_period', label: 'Pay period (to pay)' },
    { value: 'last_period', label: 'Previous pay period' },
    { value: 'today', label: t('common.today') },
    { value: 'week', label: t('common.thisWeek') },
    { value: 'month', label: t('common.thisMonth') },
  ]
}

function calcHours(clockIn: string, clockOut: string | null, fallbackNow?: Date) {
  const end = clockOut ? new Date(clockOut) : fallbackNow
  if (!end) return null
  return (end.getTime() - new Date(clockIn).getTime()) / 3600000
}

function localeTag(locale: Locale) {
  return locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US'
}

function fmtTime(iso: string, locale: Locale) {
  return new Date(iso).toLocaleTimeString(localeTag(locale), { hour: '2-digit', minute: '2-digit' })
}

function fmtDate(iso: string, locale: Locale) {
  return new Date(iso).toLocaleDateString(localeTag(locale), { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtElapsed(hours: number, label: string) {
  const h = Math.floor(hours)
  const m = Math.floor((hours - h) * 60)
  return `${h}h ${m}m ${label}`
}

/** Midpoint 'HH:MM' between two 'HH:MM' times, for a half-day manual entry. */
function midpointTime(start: string, end: string): string {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mid = Math.round((sh * 60 + sm + eh * 60 + em) / 2)
  const h = Math.floor(mid / 60), m = mid % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function toLocalDatetimeValue(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getRange(filter: string, period: CompanyPeriodSettings | null): { start: Date; end: Date | null } | null {
  const now = new Date()
  if (filter === 'today') {
    const d = new Date(now); d.setHours(0, 0, 0, 0); return { start: d, end: null }
  }
  if (filter === 'week') {
    const d = new Date(now); d.setDate(now.getDate() - now.getDay()); d.setHours(0, 0, 0, 0); return { start: d, end: null }
  }
  if (filter === 'month') {
    const d = new Date(now); d.setDate(1); d.setHours(0, 0, 0, 0); return { start: d, end: null }
  }
  // Same company pay period as Payroll and the employee screens.
  if ((filter === 'current_period' || filter === 'last_period') && period) {
    return filter === 'current_period'
      ? getPayPeriodRange(period, now)
      : getPreviousPayPeriodRange(period, now)
  }
  return null
}

export default function TimePage() {
  const { t, locale } = useTranslation()
  const companyId = useCompanyId()

  const [tab, setTab] = useState<'entries' | 'team'>('entries')
  const [activeEntries, setActiveEntries] = useState<TimeEntry[]>([])
  const [closedEntries, setClosedEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [periodSettings, setPeriodSettings] = useState<CompanyPeriodSettings | null>(null)
  const [clockWindow, setClockWindow] = useState<ClockWindowSettings>(DEFAULT_CLOCK_WINDOW)
  const [empFilter, setEmpFilter] = useState('')
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [now, setNow] = useState(() => new Date())

  // Clock-out modal
  const [clockOutEntry, setClockOutEntry] = useState<TimeEntry | null>(null)
  const [clockOutIsFullDay, setClockOutIsFullDay] = useState(true)
  const [clockOutNotes, setClockOutNotes] = useState('')
  const [clockOutSaving, setClockOutSaving] = useState(false)
  const [clockOutError, setClockOutError] = useState('')

  // Edit modal
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null)
  const [editClockIn, setEditClockIn] = useState('')
  const [editClockOut, setEditClockOut] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editProjectId, setEditProjectId] = useState('')
  const [editIsFullDay, setEditIsFullDay] = useState(true)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Add entry modal
  const [addOpen, setAddOpen] = useState(false)
  const [addType, setAddType] = useState<'profile' | 'worker'>('profile')
  const [addPersonId, setAddPersonId] = useState('')
  const [addDate, setAddDate] = useState('')
  const [addIsFullDay, setAddIsFullDay] = useState(true)
  const [addProjectId, setAddProjectId] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [addSaving, setAddSaving] = useState(false)
  const [addError, setAddError] = useState('')

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Tick elapsed time every minute
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    loadCompanyPeriodSettings(supabase, companyId).then(setPeriodSettings)
    // Manual entries should land inside the company's own configured work
    // day, not a hardcoded 8-to-5 — a company with a different shift window
    // (or a different timezone) would otherwise get entries dated for the
    // wrong day/hours.
    supabase
      .from('company_document_settings')
      .select('timezone, clock_in_window_start, clock_out_deadline')
      .eq('company_id', companyId)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return
        setClockWindow({
          ...DEFAULT_CLOCK_WINDOW,
          timezone: data.timezone ?? DEFAULT_CLOCK_WINDOW.timezone,
          clock_in_window_start: data.clock_in_window_start ?? DEFAULT_CLOCK_WINDOW.clock_in_window_start,
          clock_out_deadline: data.clock_out_deadline ?? DEFAULT_CLOCK_WINDOW.clock_out_deadline,
        })
      })
  }, [companyId])

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const needsPeriod = filter === 'current_period' || filter === 'last_period'
    if (needsPeriod && !periodSettings) return // loads as soon as the company's pay period arrives
    const range = getRange(filter, periodSettings)

    let closedQuery = supabase
      .from('time_entries')
      .select(ENTRY_SELECT)
      .eq('company_id', companyId)
      .not('clock_out', 'is', null)
      .order('clock_in', { ascending: false })
      .limit(200)

    if (range) closedQuery = closedQuery.gte('clock_in', range.start.toISOString())
    if (range?.end) closedQuery = closedQuery.lte('clock_in', range.end.toISOString())
    if (empFilter) closedQuery = closedQuery.eq('employee_id', empFilter)

    const [activeRes, closedRes, empsRes, projsRes] = await Promise.all([
      supabase
        .from('time_entries')
        .select(ENTRY_SELECT)
        .eq('company_id', companyId)
        .is('clock_out', null)
        .order('clock_in', { ascending: false }),
      closedQuery,
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId).eq('status', 'active').eq('role', 'employee').order('full_name'),
      supabase.from('projects').select('id, name').eq('company_id', companyId).eq('status', 'active').order('name'),
    ])

    setActiveEntries((activeRes.data ?? []) as unknown as TimeEntry[])
    setClosedEntries((closedRes.data ?? []) as unknown as TimeEntry[])
    setEmployees(empsRes.data ?? [])
    setProjects(projsRes.data ?? [])
    setLoading(false)
  }, [filter, empFilter, companyId, periodSettings])

  useEffect(() => { load() }, [load])

  async function approve(id: string) {
    setActionId(id)
    const supabase = createClient()
    const { error } = await supabase.from('time_entries').update({ approval_status: 'approved' }).eq('id', id).eq('company_id', companyId)
    writeFailed(error, 'approve this entry')
    load()
    setActionId(null)
  }

  async function reject(id: string) {
    setActionId(id)
    const supabase = createClient()
    const { error } = await supabase.from('time_entries').update({ approval_status: 'rejected' }).eq('id', id).eq('company_id', companyId)
    writeFailed(error, 'reject this entry')
    load()
    setActionId(null)
  }

  function openClockOut(entry: TimeEntry) {
    setClockOutEntry(entry)
    setClockOutIsFullDay(true)
    setClockOutNotes('')
    setClockOutError('')
  }

  async function handleClockOut() {
    if (!clockOutEntry) return
    setClockOutSaving(true)
    setClockOutError('')
    const res = await supervisorClockOut({
      entryId: clockOutEntry.id,
      isFullDay: clockOutIsFullDay,
      notes: clockOutNotes || undefined,
    })
    setClockOutSaving(false)
    if (res.error) { setClockOutError(res.error); return }
    setClockOutEntry(null)
    load()
  }

  function openAdd() {
    const n = new Date()
    const pad = (x: number) => String(x).padStart(2, '0')
    const today = `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`
    setAddType('profile')
    setAddPersonId(employees[0]?.id ?? '')
    setAddDate(today)
    setAddIsFullDay(true)
    setAddProjectId('')
    setAddNotes('')
    setAddError('')
    setAddOpen(true)
  }

  async function saveAdd() {
    if (!addPersonId) { setAddError('Select an employee or worker.'); return }
    if (!addDate) { setAddError('Date is required.'); return }
    setAddSaving(true)
    setAddError('')
    const startTime = clockWindow.clock_in_window_start
    const endTime = addIsFullDay ? clockWindow.clock_out_deadline : midpointTime(startTime, clockWindow.clock_out_deadline)
    const clockIn = zonedTimeToUtc(addDate, startTime, clockWindow.timezone).toISOString()
    const clockOut = zonedTimeToUtc(addDate, endTime, clockWindow.timezone).toISOString()
    const res = await createManualTimeEntry({
      profileId: addType === 'profile' ? addPersonId : undefined,
      workerId: addType === 'worker' ? addPersonId : undefined,
      clockIn,
      clockOut,
      isFullDay: addIsFullDay,
      projectId: addProjectId || undefined,
      notes: addNotes || undefined,
    })
    setAddSaving(false)
    if (res.error) { setAddError(res.error); return }
    setAddOpen(false)
    load()
  }

  function openEdit(entry: TimeEntry) {
    setEditEntry(entry)
    setEditClockIn(toLocalDatetimeValue(entry.clock_in))
    setEditClockOut(entry.clock_out ? toLocalDatetimeValue(entry.clock_out) : '')
    setEditNotes(entry.notes ?? '')
    setEditProjectId(entry.project_id ?? '')
    setEditIsFullDay(entry.is_full_day ?? true)
    setEditError('')
  }

  async function saveEdit() {
    if (!editEntry) return
    setEditSaving(true)
    setEditError('')
    const supabase = createClient()
    const updates: Record<string, unknown> = {
      clock_in: new Date(editClockIn).toISOString(),
      notes: editNotes || null,
      project_id: editProjectId || null,
      is_full_day: editIsFullDay,
    }
    if (editClockOut) {
      if (new Date(editClockOut) <= new Date(editClockIn)) {
        setEditError('Clock-out must be after clock-in.')
        setEditSaving(false)
        return
      }
      updates.clock_out = new Date(editClockOut).toISOString()
    } else {
      updates.clock_out = null
    }
    const { error } = await supabase.from('time_entries').update(updates).eq('id', editEntry.id).eq('company_id', companyId)
    if (error) { setEditError(error.message); setEditSaving(false); return }
    setEditEntry(null)
    setEditSaving(false)
    load()
  }

  async function confirmDelete() {
    if (!deleteId) return
    setDeleting(true)
    const supabase = createClient()
    const { error } = await supabase.from('time_entries').delete().eq('id', deleteId).eq('company_id', companyId)
    writeFailed(error, 'delete this entry')
    setDeleteId(null)
    setDeleting(false)
    load()
  }

  const empOptions = [
    { value: '', label: t('admin.time.allEmployees') },
    ...employees.map(e => ({ value: e.id, label: e.full_name })),
  ]

  const pendingEntries = closedEntries.filter(e => e.approval_status === 'pending')
  const historyEntries = closedEntries.filter(e => e.approval_status !== 'pending')

  // Days and hours are tracked separately (per-person pay mode, same rule as
  // calcEntryPay) so a Daily-mode crew is summarized in days, not a raw hour
  // count that has no meaning for their pay.
  let totalDays = 0
  let totalHours = 0
  for (const e of closedEntries) {
    const calc = entryCalc(e)
    if (calc?.payMode === 'daily') totalDays += calc.fullDay ? 1 : 0.5
    else totalHours += calcHours(e.clock_in, e.clock_out) ?? 0
  }

  const personName = (e: TimeEntry) =>
    e.profile?.full_name ?? e.worker?.full_name ?? t('admin.time.unknownEmployee')

  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{t('admin.time.title')}</h1>
          <p className="text-sm text-secondary mt-1">
            {activeEntries.length > 0 && (
              <span>{t('admin.time.clockedInCount').replace('{n}', String(activeEntries.length))} · </span>
            )}
            {totalDays > 0 && (
              <span>{t('admin.time.daysTotal').replace('{n}', totalDays % 1 === 0 ? String(totalDays) : totalDays.toFixed(1))}</span>
            )}
            {totalDays > 0 && totalHours > 0 && <span> · </span>}
            {totalHours > 0 && (
              <span>{t('admin.time.hoursTotal').replace('{n}', totalHours.toFixed(1))}</span>
            )}
            {pendingEntries.length > 0 && (
              <span className="text-amber"> · {t('admin.time.pendingApprovalCount').replace('{n}', String(pendingEntries.length))}</span>
            )}
          </p>
        </div>
        <button
          onClick={openAdd}
          className="shrink-0 px-3 py-2 text-sm font-medium rounded-button bg-brand text-white hover:bg-brand/90 transition-colors"
        >
          + Add Entry
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[var(--border)]">
        {(['entries', 'team'] as const).map(t2 => (
          <button
            key={t2}
            onClick={() => setTab(t2)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t2
                ? 'border-brand text-primary'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {t2 === 'entries' ? t('admin.time.tabEntries') : t('admin.time.tabTeam')}
          </button>
        ))}
      </div>

      {/* ── Team tab ── */}
      {tab === 'team' && <TeamClockIn />}

      {/* ── Entries tab ── */}
      {tab === 'entries' && (
        <div className="space-y-8">

          {/* Live Now */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-block w-2 h-2 rounded-full bg-green animate-pulse" />
              <h2 className="text-xs font-semibold text-secondary uppercase tracking-wider">
                {t('admin.time.liveNow')}
                {activeEntries.length > 0 && ` · ${activeEntries.length}`}
              </h2>
            </div>
            {loading ? (
              <p className="text-sm text-secondary">{t('common.loading')}</p>
            ) : activeEntries.length === 0 ? (
              <p className="text-sm text-secondary">{t('admin.time.noActiveSifts')}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {activeEntries.map(e => {
                  const hours = calcHours(e.clock_in, null, now) ?? 0
                  const isLong = hours >= 10
                  return (
                    <div
                      key={e.id}
                      className={`rounded-card border p-4 ${
                        isLong
                          ? 'border-amber/40 bg-amber/5'
                          : 'border-[var(--border)] bg-[var(--surface)]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-primary truncate">{personName(e)}</p>
                          {e.project?.name && (
                            <p className="text-xs text-tertiary truncate">{e.project.name}</p>
                          )}
                        </div>
                        {isLong && (
                          <span className="shrink-0 text-xs font-medium text-amber bg-amber/10 border border-amber/20 px-2 py-0.5 rounded-full">
                            {t('admin.time.longShiftAlert')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-secondary mb-3">
                        {fmtTime(e.clock_in, locale)}
                        {' · '}
                        <span className="font-medium text-primary tabular-nums">
                          {fmtElapsed(hours, t('admin.time.elapsedOn'))}
                        </span>
                      </p>
                      {e.notes && (
                        <p className="text-xs text-tertiary italic mb-2">&ldquo;{e.notes}&rdquo;</p>
                      )}
                      <button
                        onClick={() => openClockOut(e)}
                        className="w-full py-1.5 text-xs font-medium rounded-button bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
                      >
                        {t('admin.time.clockOut')}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* Pending Approvals */}
          {!loading && pendingEntries.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3">
                {t('admin.time.pendingSection')} · {pendingEntries.length}
              </h2>
              <Card padding="none">
                <div className="divide-y divide-[var(--border)]">
                  {pendingEntries.map(e => {
                    const hours = calcHours(e.clock_in, e.clock_out)
                    const isActing = actionId === e.id
                    return (
                      <div key={e.id} className="px-5 py-4 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-primary truncate max-w-[160px]">{personName(e)}</p>
                            {e.worker_id && <Badge variant="gray">Worker</Badge>}
                            <Badge variant="amber">{t('common.pending')}</Badge>
                          </div>
                          <p className="text-xs text-secondary mt-0.5">
                            {fmtDate(e.clock_in, locale)} · {fmtTime(e.clock_in, locale)}
                            {e.clock_out ? ` → ${fmtTime(e.clock_out, locale)}` : ''}
                            {e.is_full_day === false && ' · Partial'}
                          </p>
                          {e.project?.name && (
                            <p className="text-xs text-tertiary mt-0.5">{e.project.name}</p>
                          )}
                          {e.notes && <p className="text-xs text-tertiary mt-0.5 italic">&ldquo;{e.notes}&rdquo;</p>}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {hours != null && (
                            <span className="text-sm font-semibold text-primary tabular-nums">{hours.toFixed(2)}h</span>
                          )}
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => approve(e.id)}
                              disabled={isActing}
                              className="text-xs px-2 py-1 rounded-button bg-green/10 text-green hover:bg-green/20 transition-colors disabled:opacity-50"
                            >
                              {t('admin.time.approve')}
                            </button>
                            <button
                              onClick={() => reject(e.id)}
                              disabled={isActing}
                              className="text-xs px-2 py-1 rounded-button bg-surface-elevated text-secondary hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                            >
                              {t('admin.time.reject')}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>
            </section>
          )}

          {/* History */}
          <section>
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-xs font-semibold text-secondary uppercase tracking-wider">
                {t('admin.time.history')}
              </h2>
              <div className="flex gap-2">
                <div className="w-36">
                  <Select options={filterOptions(t)} value={filter} onChange={e => setFilter(e.target.value)} />
                </div>
                <div className="w-48">
                  <Select options={empOptions} value={empFilter} onChange={e => setEmpFilter(e.target.value)} />
                </div>
              </div>
            </div>
            <Card padding="none">
              {loading ? (
                <p className="px-5 py-10 text-sm text-secondary text-center">{t('common.loading')}</p>
              ) : historyEntries.length === 0 ? (
                <p className="px-5 py-10 text-sm text-secondary text-center">{t('admin.time.noHistory')}</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {historyEntries.map(e => {
                    const calc = entryCalc(e)
                    const hours = calcHours(e.clock_in, e.clock_out)
                    const status = e.approval_status ?? 'approved'
                    const clockedBySomeoneElse =
                      e.clocked_by_profile_id &&
                      e.clocked_by_profile_id !== e.employee_id &&
                      e.clocked_by?.full_name
                    return (
                      <div key={e.id} className="px-5 py-4 flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-primary truncate max-w-[160px]">{personName(e)}</p>
                            {e.worker_id && <Badge variant="gray">Worker</Badge>}
                            {status === 'rejected' && <Badge variant="gray">{t('common.rejected')}</Badge>}
                          </div>
                          <p className="text-xs text-secondary mt-0.5">
                            {fmtDate(e.clock_in, locale)} · {fmtTime(e.clock_in, locale)}
                            {e.clock_out ? ` → ${fmtTime(e.clock_out, locale)}` : ''}
                          </p>
                          {(e.city || e.project?.name) && (
                            <p className="text-xs text-tertiary mt-0.5 truncate">
                              {e.project?.name ?? ''}
                              {e.city ? ` · ${e.city}${e.state ? `, ${e.state}` : ''}` : ''}
                            </p>
                          )}
                          {e.notes && (
                            <p className="text-xs text-tertiary mt-0.5 italic">&ldquo;{e.notes}&rdquo;</p>
                          )}
                          {clockedBySomeoneElse && (
                            <p className="text-xs text-tertiary mt-1">
                              ↳ {e.clock_out
                                ? `Clocked out by ${e.clocked_by!.full_name}`
                                : `Clocked in by ${e.clocked_by!.full_name}`}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          {calc?.payMode === 'daily' ? (
                            <DayTypeBadge
                              fullDay={calc.fullDay}
                              label={calc.fullDay ? t('admin.time.fullDay') : t('admin.time.halfDay')}
                            />
                          ) : hours != null && (
                            <span className="text-sm font-semibold text-primary tabular-nums">
                              {hours.toFixed(2)}h
                            </span>
                          )}
                          <div className="flex gap-1.5 flex-wrap justify-end">
                            <button
                              onClick={() => openEdit(e)}
                              className="text-xs px-2 py-1 rounded-button bg-surface-elevated text-secondary hover:text-primary hover:bg-[var(--border)] transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setDeleteId(e.id)}
                              className="text-xs px-2 py-1 rounded-button text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
          </section>
        </div>
      )}

      {/* ── Clock Out Modal ── */}
      {clockOutEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-[var(--surface)] rounded-card w-full max-w-sm shadow-xl p-5 space-y-4">
            <h2 className="text-base font-semibold text-primary">{t('admin.time.clockOut')}</h2>
            <p className="text-sm text-secondary -mt-2">{personName(clockOutEntry)}</p>
            <div>
              <p className="text-xs font-medium text-secondary mb-2">
                {t('admin.time.fullDay')} / {t('admin.time.halfDay')}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setClockOutIsFullDay(true)}
                  className={`flex-1 py-2 text-sm rounded-button border font-medium transition-colors ${
                    clockOutIsFullDay
                      ? 'bg-brand text-white border-brand'
                      : 'border-[var(--border)] text-secondary'
                  }`}
                >
                  {t('admin.time.fullDay')}
                </button>
                <button
                  onClick={() => setClockOutIsFullDay(false)}
                  className={`flex-1 py-2 text-sm rounded-button border font-medium transition-colors ${
                    !clockOutIsFullDay
                      ? 'bg-amber text-white border-amber'
                      : 'border-[var(--border)] text-secondary'
                  }`}
                >
                  {t('admin.time.halfDay')}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Notes</label>
              <Input
                value={clockOutNotes}
                onChange={ev => setClockOutNotes(ev.target.value)}
                placeholder="Optional note"
              />
            </div>
            {clockOutError && <p className="text-xs text-danger">{clockOutError}</p>}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setClockOutEntry(null)}
                className="flex-1 px-4 py-2 text-sm rounded-button border border-[var(--border)] text-secondary hover:text-primary transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleClockOut}
                disabled={clockOutSaving}
                className="flex-1 px-4 py-2 text-sm rounded-button bg-danger text-white font-medium hover:bg-danger/90 transition-colors disabled:opacity-60"
              >
                {clockOutSaving ? t('common.saving') : t('admin.time.confirmClockOut')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-[var(--surface)] rounded-card w-full max-w-sm shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-semibold text-primary">Edit Entry</h2>
            <p className="text-sm text-secondary -mt-2">{personName(editEntry)}</p>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Clock-in</label>
              <input
                type="datetime-local"
                value={editClockIn}
                onChange={ev => setEditClockIn(ev.target.value)}
                className="w-full px-3 py-2 text-sm rounded-input border border-[var(--border)] bg-[var(--surface)] text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Clock-out</label>
              <input
                type="datetime-local"
                value={editClockOut}
                onChange={ev => setEditClockOut(ev.target.value)}
                className="w-full px-3 py-2 text-sm rounded-input border border-[var(--border)] bg-[var(--surface)] text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-2">Was this a full day?</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditIsFullDay(true)}
                  className={`flex-1 py-2 text-sm font-medium rounded-button border transition-colors ${editIsFullDay ? 'bg-brand text-white border-brand' : 'border-[var(--border)] text-secondary hover:text-primary'}`}
                >Full Day</button>
                <button
                  type="button"
                  onClick={() => setEditIsFullDay(false)}
                  className={`flex-1 py-2 text-sm font-medium rounded-button border transition-colors ${!editIsFullDay ? 'bg-brand text-white border-brand' : 'border-[var(--border)] text-secondary hover:text-primary'}`}
                >Partial Day</button>
              </div>
            </div>
            {projects.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Project / Location</label>
                <select
                  value={editProjectId}
                  onChange={e => setEditProjectId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-input border border-[var(--border)] bg-[var(--surface)] text-primary"
                >
                  <option value="">— no project —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Notes</label>
              <Input
                value={editNotes}
                onChange={ev => setEditNotes(ev.target.value)}
                placeholder="Optional note"
              />
            </div>
            {editError && <p className="text-xs text-danger">{editError}</p>}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setEditEntry(null)}
                className="flex-1 px-4 py-2 text-sm rounded-button border border-[var(--border)] text-secondary hover:text-primary transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="flex-1 px-4 py-2 text-sm rounded-button bg-brand text-white font-medium hover:bg-brand/90 transition-colors disabled:opacity-60"
              >
                {editSaving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Entry Modal ── */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-[var(--surface)] rounded-card w-full max-w-sm shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-semibold text-primary">Add Time Entry</h2>
            <p className="text-xs text-secondary -mt-2">Manual entries are saved as approved.</p>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Employee</label>
              <select
                value={addPersonId}
                onChange={e => setAddPersonId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-input border border-[var(--border)] bg-[var(--surface)] text-primary"
              >
                <option value="">— select —</option>
                {employees.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Date *</label>
              <input
                type="date"
                value={addDate}
                onChange={ev => setAddDate(ev.target.value)}
                className="w-full px-3 py-2 text-sm rounded-input border border-[var(--border)] bg-[var(--surface)] text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-secondary mb-2">Was this a full day?</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAddIsFullDay(true)}
                  className={`flex-1 py-2 text-sm font-medium rounded-button border transition-colors ${addIsFullDay ? 'bg-brand text-white border-brand' : 'border-[var(--border)] text-secondary hover:text-primary'}`}
                >Full Day</button>
                <button
                  type="button"
                  onClick={() => setAddIsFullDay(false)}
                  className={`flex-1 py-2 text-sm font-medium rounded-button border transition-colors ${!addIsFullDay ? 'bg-brand text-white border-brand' : 'border-[var(--border)] text-secondary hover:text-primary'}`}
                >Partial Day</button>
              </div>
            </div>
            {projects.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">Project (optional)</label>
                <select
                  value={addProjectId}
                  onChange={e => setAddProjectId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-input border border-[var(--border)] bg-[var(--surface)] text-primary"
                >
                  <option value="">— no project —</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-secondary mb-1">Notes (optional)</label>
              <Input
                value={addNotes}
                onChange={ev => setAddNotes(ev.target.value)}
                placeholder="e.g. make-up shift from last week"
              />
            </div>
            {addError && <p className="text-xs text-danger">{addError}</p>}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setAddOpen(false)}
                className="flex-1 px-4 py-2 text-sm rounded-button border border-[var(--border)] text-secondary hover:text-primary transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={saveAdd}
                disabled={addSaving}
                className="flex-1 px-4 py-2 text-sm rounded-button bg-brand text-white font-medium hover:bg-brand/90 transition-colors disabled:opacity-60"
              >
                {addSaving ? t('common.saving') : 'Add Entry'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-[var(--surface)] rounded-card w-full max-w-xs shadow-xl p-5 space-y-4">
            <h2 className="text-base font-semibold text-primary">Delete entry?</h2>
            <p className="text-sm text-secondary">This clock-in record will be permanently removed.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 px-4 py-2 text-sm rounded-button border border-[var(--border)] text-secondary hover:text-primary transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 text-sm rounded-button bg-danger text-white font-medium hover:bg-danger/90 transition-colors disabled:opacity-60"
              >
                {deleting ? t('common.saving') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
