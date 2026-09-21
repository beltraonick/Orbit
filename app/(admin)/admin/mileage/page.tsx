'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import {
  getMileageTrips,
  createMileageTrip,
  updateMileageTrip,
  deleteMileageTrip,
  submitMileageTrip,
  approveMileageTrip,
  rejectMileageTrip,
  getMileageRate,
  updateMileageRate,
  getVehicles,
} from '@/app/actions/mileageActions'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Vehicle { id: string; name: string; license_plate: string | null }
interface Project { id: string; name: string }
interface MileageTrip {
  id: string
  trip_date: string
  origin: string
  destination: string
  purpose: string | null
  distance_miles: number
  trip_type: 'manual' | 'gps'
  approval_status: string
  reimbursement_amount: number
  vehicle: Vehicle | null
  project: { id: string; name: string } | null
  employee: { id: string; full_name: string } | null
  reviewer_notes: string | null
  created_at: string
}

type Filter = 'all' | 'pending' | 'approved'

const BLANK_FORM = {
  trip_date: new Date().toISOString().slice(0, 10),
  origin: '',
  destination: '',
  purpose: '',
  distance_miles: '',
  vehicle_id: '',
  project_id: '',
}

const fmtMi = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`
const fmt$ = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function statusBadge(status: string) {
  if (status === 'approved') return <Badge variant="green">Approved</Badge>
  if (status === 'rejected') return <Badge variant="red">Rejected</Badge>
  if (status === 'needs_review') return <Badge variant="amber">Needs Review</Badge>
  if (status === 'submitted') return <Badge variant="blue">Submitted</Badge>
  return <Badge variant="default">Draft</Badge>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MileagePage() {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const m = (k: string) => t(`admin.mileage.${k}`)

  const [trips, setTrips] = useState<MileageTrip[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [rate, setRate] = useState(0.67)
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<MileageTrip | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [form, setForm] = useState({ ...BLANK_FORM })
  const [err, setErr] = useState('')
  const [editingRate, setEditingRate] = useState(false)
  const [rateInput, setRateInput] = useState('')
  const [savingRate, setSavingRate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getMileageTrips(filter === 'all' ? undefined : filter)
    if (res.ok) setTrips((res.trips ?? []) as unknown as MileageTrip[])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    getMileageRate().then(r => { if (r.ok && r.rate !== undefined) setRate(r.rate) })
    getVehicles().then(r => { if (r.ok) setVehicles((r.vehicles ?? []) as Vehicle[]) })

    if (!companyId) return
    createClient()
      .from('projects')
      .select('id, name')
      .eq('company_id', companyId)
      .order('name')
      .then(({ data }) => setProjects(data ?? []))
  }, [companyId])

  function openAdd() {
    setEditing(null)
    setForm({ ...BLANK_FORM })
    setErr('')
    setShowModal(true)
  }

  function openEdit(trip: MileageTrip) {
    setEditing(trip)
    setForm({
      trip_date: trip.trip_date,
      origin: trip.origin,
      destination: trip.destination,
      purpose: trip.purpose ?? '',
      distance_miles: String(trip.distance_miles),
      vehicle_id: trip.vehicle?.id ?? '',
      project_id: trip.project?.id ?? '',
    })
    setErr('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.origin.trim()) return setErr('Origin required')
    if (!form.destination.trim()) return setErr('Destination required')
    const dist = parseFloat(form.distance_miles)
    if (!dist || dist <= 0) return setErr('Valid distance required')

    setSaving(true)
    setErr('')
    const payload = {
      trip_date: form.trip_date,
      origin: form.origin,
      destination: form.destination,
      purpose: form.purpose || undefined,
      distance_miles: dist,
      trip_type: 'manual' as const,
      vehicle_id: form.vehicle_id || undefined,
      project_id: form.project_id || undefined,
    }

    const res = editing
      ? await updateMileageTrip(editing.id, payload)
      : await createMileageTrip(payload)

    if (res.error) { setErr(res.error); setSaving(false); return }
    setSaving(false)
    setShowModal(false)
    load()
  }

  async function handleSaveRate() {
    const r = parseFloat(rateInput)
    if (!r || r <= 0) return
    setSavingRate(true)
    const res = await updateMileageRate(r)
    if (!res.error) { setRate(r); setEditingRate(false) }
    setSavingRate(false)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this trip?')) return
    await deleteMileageTrip(id)
    load()
  }

  async function handleApprove(id: string) {
    await approveMileageTrip(id, reviewNotes || undefined)
    setReviewingId(null)
    setReviewNotes('')
    load()
  }

  async function handleReject(id: string) {
    await rejectMileageTrip(id, reviewNotes || undefined)
    setReviewingId(null)
    setReviewNotes('')
    load()
  }

  // ─── Summary stats ─────────────────────────────────────────────────────────
  const totalMiles = trips.reduce((s, t) => s + t.distance_miles, 0)
  const totalReimbursement = trips.reduce((s, t) => s + t.reimbursement_amount, 0)
  const tripCount = trips.length

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: m('filterAll') },
    { key: 'pending', label: m('filterPending') },
    { key: 'approved', label: m('filterApproved') },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{m('title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{m('subtitle')}</p>
        </div>
        <Button onClick={openAdd}>{m('addTrip')}</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 text-center">
          <div className="text-xs text-gray-500">{m('summaryTrips')}</div>
          <div className="text-lg font-bold mt-1">{tripCount}</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-xs text-gray-500">{m('summaryMiles')}</div>
          <div className="text-lg font-bold mt-1">{fmtMi(totalMiles)}</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-xs text-gray-500">{m('summaryReimbursement')}</div>
          <div className="text-lg font-bold mt-1 text-green">{fmt$(totalReimbursement)}</div>
        </Card>
      </div>

      {/* Rate — inline editor */}
      <div className="flex items-center gap-2">
        {editingRate ? (
          <>
            <span className="text-xs text-gray-400">{m('currentRate')}:</span>
            <span className="text-xs text-gray-400">$</span>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={rateInput}
              onChange={e => setRateInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveRate(); if (e.key === 'Escape') setEditingRate(false) }}
              className="w-20 border border-gray-300 dark:border-gray-600 rounded px-2 py-0.5 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              autoFocus
            />
            <span className="text-xs text-gray-400">/mi</span>
            <button
              onClick={handleSaveRate}
              disabled={savingRate}
              className="text-xs font-medium text-blue hover:opacity-80 disabled:opacity-50"
            >{savingRate ? 'Saving…' : 'Save'}</button>
            <button
              onClick={() => setEditingRate(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >Cancel</button>
          </>
        ) : (
          <>
            <span className="text-xs text-gray-400">{m('currentRate')}: {fmt$(rate)}{m('perMile')}</span>
            <button
              onClick={() => { setRateInput(String(rate)); setEditingRate(true) }}
              className="text-xs font-medium text-blue hover:opacity-80"
            >Edit</button>
          </>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.key
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>
      ) : trips.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">{filter === 'all' ? m('noTrips') : m('noTripsFiltered')}</p>
      ) : (
        <div className="space-y-3">
          {trips.map(trip => (
            <Card key={trip.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{trip.origin} → {trip.destination}</span>
                    {statusBadge(trip.approval_status)}
                    <Badge variant="default">{trip.trip_type === 'gps' ? m('tripTypeGps') : m('tripTypeManual')}</Badge>
                  </div>
                  <div className="text-sm text-gray-500 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                    <span>{trip.trip_date}</span>
                    {trip.employee && <span>{trip.employee.full_name}</span>}
                    {trip.purpose && <span>{trip.purpose}</span>}
                    {trip.vehicle && <span>{trip.vehicle.name}</span>}
                    {trip.project && <span>{trip.project.name}</span>}
                  </div>
                  {trip.reviewer_notes && (
                    <p className="text-xs text-gray-400 mt-1 italic">{trip.reviewer_notes}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold">{fmtMi(trip.distance_miles)}</div>
                  <div className="text-green font-semibold">{fmt$(trip.reimbursement_amount)}</div>
                  <div className="flex gap-1 mt-2 flex-wrap justify-end">
                    {trip.approval_status === 'draft' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(trip)}>{m('editTrip')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => submitMileageTrip(trip.id).then(load)}>{m('submitForReview')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(trip.id)}>✕</Button>
                      </>
                    )}
                    {['submitted', 'needs_review'].includes(trip.approval_status) && (
                      <>
                        {reviewingId === trip.id ? (
                          <div className="flex flex-col gap-1 w-48">
                            <Input
                              value={reviewNotes}
                              onChange={e => setReviewNotes(e.target.value)}
                              placeholder={m('notesPlaceholder')}
                            />
                            <div className="flex gap-1">
                              <Button size="sm" onClick={() => handleApprove(trip.id)}>{m('approve')}</Button>
                              <Button size="sm" variant="ghost" onClick={() => handleReject(trip.id)}>{m('reject')}</Button>
                              <Button size="sm" variant="ghost" onClick={() => setReviewingId(null)}>✕</Button>
                            </div>
                          </div>
                        ) : (
                          <Button size="sm" onClick={() => { setReviewingId(trip.id); setReviewNotes('') }}>Review</Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-4">
          <Card className="w-full max-w-md p-5 space-y-4">
            <h2 className="font-semibold text-lg">{editing ? m('editTrip') : m('addTripTitle')}</h2>

            <Input
              label={m('tripDate')}
              type="date"
              value={form.trip_date}
              onChange={e => setForm(f => ({ ...f, trip_date: e.target.value }))}
            />
            <Input
              label={m('origin')}
              value={form.origin}
              onChange={e => setForm(f => ({ ...f, origin: e.target.value }))}
              placeholder={m('originPlaceholder')}
            />
            <Input
              label={m('destination')}
              value={form.destination}
              onChange={e => setForm(f => ({ ...f, destination: e.target.value }))}
              placeholder={m('destinationPlaceholder')}
            />
            <Input
              label={m('purpose')}
              value={form.purpose}
              onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
              placeholder={m('purposePlaceholder')}
            />
            <Input
              label={m('distance')}
              type="number"
              value={form.distance_miles}
              onChange={e => setForm(f => ({ ...f, distance_miles: e.target.value }))}
              placeholder="0.0"
            />
            {form.distance_miles && parseFloat(form.distance_miles) > 0 && (
              <p className="text-xs text-gray-400">
                Reimbursement: {fmt$(parseFloat(form.distance_miles) * rate)} (@ {fmt$(rate)}/mi)
              </p>
            )}

            {vehicles.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{m('vehicle')}</label>
                <select
                  value={form.vehicle_id}
                  onChange={ev => setForm(f => ({ ...f, vehicle_id: ev.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800"
                >
                  <option value="">{m('noVehicle')}</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}{v.license_plate ? ` (${v.license_plate})` : ''}</option>)}
                </select>
              </div>
            )}

            {projects.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{m('project')}</label>
                <select
                  value={form.project_id}
                  onChange={ev => setForm(f => ({ ...f, project_id: ev.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800"
                >
                  <option value="">— None —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}

            {err && <p className="text-red-500 text-sm">{err}</p>}

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? 'Saving…' : editing ? t('common.saveChanges') : m('saveDraft')}
              </Button>
              <Button variant="ghost" onClick={() => setShowModal(false)} className="flex-1">{t('common.cancel')}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
