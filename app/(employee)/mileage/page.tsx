'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { usePermissions } from '@/lib/permissions-context'
import { hasPermission } from '@/lib/permissions'
import {
  getMileageTrips,
  createMileageTrip,
  updateMileageTrip,
  deleteMileageTrip,
  submitMileageTrip,
  getMileageRate,
  getVehicles,
} from '@/app/actions/mileageActions'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'

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
  reviewer_notes: string | null
}

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

// ─── GPS Tracking State ───────────────────────────────────────────────────────

interface GpsState {
  active: boolean
  startLat: number | null
  startLng: number | null
  startTime: number | null
  watchId: number | null
  currentLat: number | null
  currentLng: number | null
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8 // miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function statusBadge(status: string) {
  if (status === 'approved') return <Badge variant="green">Approved</Badge>
  if (status === 'rejected') return <Badge variant="red">Rejected</Badge>
  if (status === 'needs_review') return <Badge variant="amber">Needs Review</Badge>
  if (status === 'submitted') return <Badge variant="blue">Submitted</Badge>
  return <Badge variant="default">Draft</Badge>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EmployeeMileagePage() {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const permissions = usePermissions()
  const m = (k: string) => t(`admin.mileage.${k}`)

  const canTrack = hasPermission(permissions, 'track_mileage')
  const canManual = hasPermission(permissions, 'manual_mileage')

  const [trips, setTrips] = useState<MileageTrip[]>([])
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [_projects, setProjects] = useState<Project[]>([])
  const [rate, setRate] = useState(0.67)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [editing, setEditing] = useState<MileageTrip | null>(null)
  const [form, setForm] = useState({ ...BLANK_FORM })
  const [err, setErr] = useState('')
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [gps, setGps] = useState<GpsState>({
    active: false, startLat: null, startLng: null, startTime: null,
    watchId: null, currentLat: null, currentLng: null,
  })

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getMileageTrips()
    if (res.ok) setTrips((res.trips ?? []) as unknown as MileageTrip[])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!canTrack) return
    load()
    getMileageRate().then(r => { if (r.ok && r.rate !== undefined) setRate(r.rate) })
    getVehicles().then(r => { if (r.ok) setVehicles((r.vehicles ?? []) as Vehicle[]) })
    if (!companyId) return
    createClient()
      .from('projects')
      .select('id, name')
      .eq('company_id', companyId)
      .order('name')
      .then(({ data }) => setProjects(data ?? []))
  }, [companyId, canTrack, load])

  // Cleanup GPS watch on unmount
  useEffect(() => {
    return () => {
      if (gps.watchId !== null) navigator.geolocation.clearWatch(gps.watchId)
    }
  }, [gps.watchId])

  if (!canTrack) {
    return (
      <div className="p-4 pt-20 pb-28 flex flex-col items-center justify-center min-h-screen gap-3">
        <p className="text-gray-400 text-center">You do not have permission to track mileage. Contact your admin.</p>
      </div>
    )
  }

  function startGps() {
    if (!navigator.geolocation) {
      setGpsError(m('gpsNotSupported'))
      return
    }
    setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const watchId = navigator.geolocation.watchPosition(
          p => setGps(g => ({ ...g, currentLat: p.coords.latitude, currentLng: p.coords.longitude })),
          () => {},
          { enableHighAccuracy: true }
        )
        setGps({
          active: true,
          startLat: pos.coords.latitude,
          startLng: pos.coords.longitude,
          startTime: Date.now(),
          watchId,
          currentLat: pos.coords.latitude,
          currentLng: pos.coords.longitude,
        })
      },
      err => {
        if (err.code === err.PERMISSION_DENIED) setGpsError(m('gpsPermissionDenied'))
        else setGpsError(m('gpsNotSupported'))
      },
      { enableHighAccuracy: true }
    )
  }

  async function endGps() {
    if (!gps.active || gps.startLat === null || gps.currentLat === null) return
    if (gps.watchId !== null) navigator.geolocation.clearWatch(gps.watchId)

    const dist = haversineDistance(gps.startLat!, gps.startLng!, gps.currentLat!, gps.currentLng!)
    setSaving(true)
    const res = await createMileageTrip({
      trip_date: new Date().toISOString().slice(0, 10),
      origin: `${gps.startLat!.toFixed(5)},${gps.startLng!.toFixed(5)}`,
      destination: `${gps.currentLat!.toFixed(5)},${gps.currentLng!.toFixed(5)}`,
      distance_miles: Math.round(dist * 100) / 100,
      trip_type: 'gps',
      gps_start_lat: gps.startLat!,
      gps_start_lng: gps.startLng!,
      gps_end_lat: gps.currentLat!,
      gps_end_lng: gps.currentLng!,
    })
    setSaving(false)
    setGps({ active: false, startLat: null, startLng: null, startTime: null, watchId: null, currentLat: null, currentLng: null })
    if (!res.error) load()
  }

  function openManual() {
    setEditing(null)
    setForm({ ...BLANK_FORM })
    setErr('')
    setShowManual(true)
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
    setShowManual(true)
  }

  async function handleSaveManual() {
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
    setShowManual(false)
    load()
  }

  const pending = trips.filter(t => ['draft', 'submitted', 'needs_review'].includes(t.approval_status))
  const history = trips.filter(t => ['approved', 'rejected'].includes(t.approval_status))

  const liveDistance = gps.active && gps.startLat !== null && gps.currentLat !== null
    ? haversineDistance(gps.startLat!, gps.startLng!, gps.currentLat!, gps.currentLng!)
    : 0

  return (
    <div className="p-4 pt-20 pb-28 space-y-4">
      <div>
        <h1 className="text-xl font-bold">{m('title')}</h1>
        <p className="text-sm text-gray-500">{m('subtitle')}</p>
      </div>

      {/* GPS Trip button */}
      {gps.active ? (
        <Card className="p-4 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-green-700 dark:text-green-400">{m('gpsTracking')}</p>
              <p className="text-sm text-green-600 dark:text-green-500">{fmtMi(liveDistance)} recorded</p>
            </div>
            <Button onClick={endGps} disabled={saving}>{m('endGps')}</Button>
          </div>
        </Card>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <Button onClick={startGps}>{m('startGps')}</Button>
          {canManual && <Button variant="ghost" onClick={openManual}>{m('addTrip')}</Button>}
        </div>
      )}

      {gpsError && <p className="text-red-500 text-sm">{gpsError}</p>}

      <p className="text-xs text-gray-400">{m('currentRate')}: {fmt$(rate)}{m('perMile')}</p>

      {/* List */}
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>
      ) : trips.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">{m('noTrips')}</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{m('filterPending')}</h2>
              {pending.map(trip => (
                <Card key={trip.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{trip.origin} → {trip.destination}</span>
                        {statusBadge(trip.approval_status)}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{trip.trip_date}{trip.purpose ? ` · ${trip.purpose}` : ''}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-medium">{fmtMi(trip.distance_miles)}</div>
                      <div className="text-green-600 font-bold">{fmt$(trip.reimbursement_amount)}</div>
                      {trip.approval_status === 'draft' && (
                        <div className="flex gap-1 mt-2">
                          {canManual && <Button size="sm" variant="ghost" onClick={() => openEdit(trip)}>{m('editTrip')}</Button>}
                          <Button size="sm" variant="ghost" onClick={() => submitMileageTrip(trip.id).then(load)}>{m('submitForReview')}</Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteMileageTrip(trip.id).then(load)}>✕</Button>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">History</h2>
              {history.map(trip => (
                <Card key={trip.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{trip.origin} → {trip.destination}</span>
                        {statusBadge(trip.approval_status)}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{trip.trip_date}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm">{fmtMi(trip.distance_miles)}</div>
                      <div className="font-bold">{fmt$(trip.reimbursement_amount)}</div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Manual entry modal */}
      {showManual && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center p-4">
          <Card className="w-full max-w-md p-5 space-y-4">
            <h2 className="font-semibold text-lg">{editing ? m('editTrip') : m('addTripTitle')}</h2>

            <Input label={m('tripDate')} type="date" value={form.trip_date} onChange={e => setForm(f => ({ ...f, trip_date: e.target.value }))} />
            <Input label={m('origin')} value={form.origin} onChange={e => setForm(f => ({ ...f, origin: e.target.value }))} placeholder={m('originPlaceholder')} />
            <Input label={m('destination')} value={form.destination} onChange={e => setForm(f => ({ ...f, destination: e.target.value }))} placeholder={m('destinationPlaceholder')} />
            <Input label={m('purpose')} value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder={m('purposePlaceholder')} />
            <Input label={m('distance')} type="number" value={form.distance_miles} onChange={e => setForm(f => ({ ...f, distance_miles: e.target.value }))} placeholder="0.0" />
            {form.distance_miles && parseFloat(form.distance_miles) > 0 && (
              <p className="text-xs text-gray-400">Reimbursement: {fmt$(parseFloat(form.distance_miles) * rate)}</p>
            )}

            {vehicles.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{m('vehicle')}</label>
                <select value={form.vehicle_id} onChange={ev => setForm(f => ({ ...f, vehicle_id: ev.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800">
                  <option value="">{m('noVehicle')}</option>
                  {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            )}

            {err && <p className="text-red-500 text-sm">{err}</p>}

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSaveManual} disabled={saving} className="flex-1">{saving ? 'Saving…' : m('saveDraft')}</Button>
              <Button variant="ghost" onClick={() => setShowManual(false)} className="flex-1">{t('common.cancel')}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
