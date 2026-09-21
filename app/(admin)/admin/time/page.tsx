'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import type { Locale } from '@/lib/i18n/translate'

interface TimeEntry {
  id: string
  employee_id: string | null
  worker_id: string | null
  clock_in: string
  clock_out: string | null
  city: string | null
  state: string | null
  notes: string | null
  is_full_day: boolean | null
  approval_status: string | null
  clocked_by_profile_id: string | null
  project: { name: string } | null
  profile: { full_name: string; email: string } | null
  worker: { full_name: string } | null
  clocked_by: { full_name: string } | null
}

function filterOptions(t: (key: string) => string) {
  return [
    { value: 'today', label: t('common.today') },
    { value: 'week', label: t('common.thisWeek') },
    { value: 'month', label: t('common.thisMonth') },
    { value: 'all', label: t('admin.time.allTime') },
  ]
}

function calcHours(clockIn: string, clockOut: string | null) {
  if (!clockOut) return null
  return (new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 3600000
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

function toLocalDatetimeValue(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function getRange(filter: string): Date | null {
  const now = new Date()
  if (filter === 'today') {
    const d = new Date(now); d.setHours(0, 0, 0, 0); return d
  }
  if (filter === 'week') {
    const d = new Date(now); d.setDate(now.getDate() - now.getDay()); d.setHours(0, 0, 0, 0); return d
  }
  if (filter === 'month') {
    const d = new Date(now); d.setDate(1); d.setHours(0, 0, 0, 0); return d
  }
  return null
}

export default function TimePage() {
  const { t, locale } = useTranslation()
  const companyId = useCompanyId()
  const [entries, setEntries] = useState<TimeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)
  const [filter, setFilter] = useState('week')
  const [empFilter, setEmpFilter] = useState('')
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([])

  // Edit modal
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null)
  const [editClockIn, setEditClockIn] = useState('')
  const [editClockOut, setEditClockOut] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const rangeStart = getRange(filter)

    let query = supabase
      .from('time_entries')
      .select(`
        id, employee_id, worker_id, clock_in, clock_out,
        city, state, notes, is_full_day, approval_status,
        clocked_by_profile_id,
        project:project_id(name),
        profile:employee_id(full_name, email),
        worker:worker_id(full_name),
        clocked_by:clocked_by_profile_id(full_name)
      `)
      .eq('company_id', companyId)
      .order('clock_in', { ascending: false })
      .limit(200)

    if (rangeStart) query = query.gte('clock_in', rangeStart.toISOString())
    if (empFilter) query = query.eq('employee_id', empFilter)

    const [{ data }, { data: emps }] = await Promise.all([
      query,
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId).eq('status', 'active').order('full_name'),
    ])

    setEntries((data ?? []) as unknown as TimeEntry[])
    setEmployees(emps ?? [])
    setLoading(false)
  }, [filter, empFilter, companyId])

  useEffect(() => { load() }, [load])

  async function approve(id: string) {
    setActionId(id)
    const supabase = createClient()
    await supabase.from('time_entries').update({ approval_status: 'approved' }).eq('id', id)
    load()
    setActionId(null)
  }

  async function reject(id: string) {
    setActionId(id)
    const supabase = createClient()
    await supabase.from('time_entries').update({ approval_status: 'rejected' }).eq('id', id)
    load()
    setActionId(null)
  }

  async function clockOut(id: string) {
    setActionId(id)
    const supabase = createClient()
    await supabase.from('time_entries').update({ clock_out: new Date().toISOString() }).eq('id', id)
    load()
    setActionId(null)
  }

  function openEdit(entry: TimeEntry) {
    setEditEntry(entry)
    setEditClockIn(toLocalDatetimeValue(entry.clock_in))
    setEditClockOut(entry.clock_out ? toLocalDatetimeValue(entry.clock_out) : '')
    setEditNotes(entry.notes ?? '')
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
    }
    if (editClockOut) {
      updates.clock_out = new Date(editClockOut).toISOString()
      if (new Date(editClockOut) <= new Date(editClockIn)) {
        setEditError('Clock-out must be after clock-in.')
        setEditSaving(false)
        return
      }
    } else {
      updates.clock_out = null
    }
    const { error } = await supabase.from('time_entries').update(updates).eq('id', editEntry.id)
    if (error) {
      setEditError(error.message)
      setEditSaving(false)
      return
    }
    setEditEntry(null)
    setEditSaving(false)
    load()
  }

  async function confirmDelete() {
    if (!deleteId) return
    setDeleting(true)
    const supabase = createClient()
    await supabase.from('time_entries').delete().eq('id', deleteId)
    setDeleteId(null)
    setDeleting(false)
    load()
  }

  const empOptions = [
    { value: '', label: t('admin.time.allEmployees') },
    ...employees.map(e => ({ value: e.id, label: e.full_name })),
  ]

  const pendingCount = entries.filter(e => e.approval_status === 'pending' && e.clock_out).length
  const activeCount = entries.filter(e => !e.clock_out).length
  const totalHours = entries.reduce((sum, e) => sum + (calcHours(e.clock_in, e.clock_out) ?? 0), 0)

  const personName = (e: TimeEntry) =>
    e.profile?.full_name ?? e.worker?.full_name ?? t('admin.time.unknownEmployee')

  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{t('admin.time.title')}</h1>
        <p className="text-sm text-secondary mt-1">
          {activeCount > 0 && `${t('admin.time.clockedInCount').replace('{n}', String(activeCount))} · `}
          {t('admin.time.hoursTotal').replace('{n}', totalHours.toFixed(1))} · {pendingCount > 0 && <span className="text-amber">{t('admin.time.pendingApprovalCount').replace('{n}', String(pendingCount))}</span>}
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div className="w-40">
          <Select options={filterOptions(t)} value={filter} onChange={e => setFilter(e.target.value)} />
        </div>
        <div className="w-52">
          <Select options={empOptions} value={empFilter} onChange={e => setEmpFilter(e.target.value)} />
        </div>
      </div>

      <Card padding="none">
        {loading ? (
          <p className="px-5 py-10 text-sm text-secondary text-center">{t('common.loading')}</p>
        ) : entries.length === 0 ? (
          <p className="px-5 py-10 text-sm text-secondary text-center">{t('admin.time.noEntriesForPeriod')}</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {entries.map(e => {
              const hours = calcHours(e.clock_in, e.clock_out)
              const status = e.clock_out ? (e.approval_status ?? 'approved') : 'active'
              const isActing = actionId === e.id
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
                      {status === 'active' && <Badge variant="green">{t('common.active')}</Badge>}
                      {status === 'pending' && <Badge variant="amber">{t('common.pending')}</Badge>}
                      {status === 'rejected' && <Badge variant="gray">{t('common.rejected')}</Badge>}
                    </div>
                    <p className="text-xs text-secondary mt-0.5">
                      {fmtDate(e.clock_in, locale)} · {fmtTime(e.clock_in, locale)}
                      {e.clock_out ? ` → ${fmtTime(e.clock_out, locale)}` : t('admin.time.inProgress')}
                      {e.is_full_day === true && ' · Full day'}
                      {e.is_full_day === false && e.clock_out && ` · Partial`}
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
                    {/* Attribution footer — like photo credit */}
                    {clockedBySomeoneElse && (
                      <p className="text-xs text-tertiary mt-1">
                        ↳ {e.clock_out
                          ? `Clocked out by ${e.clocked_by!.full_name}`
                          : `Clocked in by ${e.clocked_by!.full_name}`}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0">
                    {hours != null && (
                      <span className="text-sm font-semibold text-primary tabular-nums">
                        {hours.toFixed(2)}h
                      </span>
                    )}
                    <div className="flex gap-1.5 flex-wrap justify-end">
                      {!e.clock_out && (
                        <button
                          onClick={() => clockOut(e.id)}
                          disabled={isActing}
                          className="text-xs px-2 py-1 rounded-button bg-danger/10 text-danger hover:bg-danger/20 transition-colors disabled:opacity-50"
                        >
                          {t('admin.time.clockOut')}
                        </button>
                      )}
                      {status === 'pending' && (
                        <>
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
                        </>
                      )}
                      {/* Admin-only edit & delete */}
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
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="flex-1 px-4 py-2 text-sm rounded-button bg-brand text-white font-medium hover:bg-brand/90 transition-colors disabled:opacity-60"
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-[var(--surface)] rounded-card w-full max-w-xs shadow-xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-semibold text-primary">Delete entry?</h2>
            <p className="text-sm text-secondary">This clock-in record will be permanently removed.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 px-4 py-2 text-sm rounded-button border border-[var(--border)] text-secondary hover:text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex-1 px-4 py-2 text-sm rounded-button bg-danger text-white font-medium hover:bg-danger/90 transition-colors disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
