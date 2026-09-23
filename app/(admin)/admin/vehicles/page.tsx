'use client'

import { actionFailed } from '@/lib/write-feedback'
import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { getVehicles, createVehicle, updateVehicle, deleteVehicle } from '@/app/actions/vehicleActions'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssignedTo { id: string; full_name: string }
interface Vehicle {
  id: string
  name: string
  license_plate: string | null
  vehicle_type: 'company' | 'personal' | 'rental'
  year: number | null
  make: string | null
  model: string | null
  color: string | null
  status: 'active' | 'archived'
  assigned_to: AssignedTo | null
}
interface Profile { id: string; full_name: string }

const BLANK_FORM = {
  name: '',
  license_plate: '',
  vehicle_type: 'company' as 'company' | 'personal' | 'rental',
  year: '',
  make: '',
  model: '',
  color: '',
  assigned_to_profile_id: '',
}

const TYPE_COLORS: Record<string, string> = {
  company: 'blue',
  personal: 'default',
  rental: 'amber',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VehiclesPage() {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const v = (k: string) => t(`admin.vehicles.${k}`)

  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [form, setForm] = useState({ ...BLANK_FORM })
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getVehicles()
    if (res.ok) setVehicles((res.vehicles ?? []) as unknown as Vehicle[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!companyId) return
    createClient()
      .from('profiles')
      .select('id, full_name')
      .eq('company_id', companyId)
      .eq('status', 'active')
      .in('role', ['admin', 'employee'])
      .order('full_name')
      .then(({ data }) => setEmployees(data ?? []))
  }, [companyId])

  function openAdd() {
    setEditing(null)
    setForm({ ...BLANK_FORM })
    setErr('')
    setShowModal(true)
  }

  function openEdit(veh: Vehicle) {
    setEditing(veh)
    setForm({
      name: veh.name,
      license_plate: veh.license_plate ?? '',
      vehicle_type: veh.vehicle_type,
      year: veh.year ? String(veh.year) : '',
      make: veh.make ?? '',
      model: veh.model ?? '',
      color: veh.color ?? '',
      assigned_to_profile_id: veh.assigned_to?.id ?? '',
    })
    setErr('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return setErr(v('vehicleName') + ' required')

    setSaving(true)
    setErr('')
    const payload = {
      name: form.name,
      license_plate: form.license_plate || undefined,
      vehicle_type: form.vehicle_type,
      year: form.year ? parseInt(form.year) : undefined,
      make: form.make || undefined,
      model: form.model || undefined,
      color: form.color || undefined,
      assigned_to_profile_id: form.assigned_to_profile_id || undefined,
    }

    const res = editing
      ? await updateVehicle(editing.id, payload)
      : await createVehicle(payload)

    if (res.error) { setErr(res.error); setSaving(false); return }
    setSaving(false)
    setShowModal(false)
    load()
  }

  async function handleArchive(veh: Vehicle) {
    actionFailed(await updateVehicle(veh.id, { status: veh.status === 'active' ? 'archived' : 'active' }))
    load()
  }

  async function handleDelete(id: string) {
    if (!confirm(v('confirmDelete'))) return
    const res = await deleteVehicle(id)
    if (res.error) { alert(res.error); return }
    load()
  }

  const displayed = vehicles.filter(veh => showArchived ? veh.status === 'archived' : veh.status === 'active')

  return (
    <div className="p-4 md:p-6 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{v('title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{v('subtitle')}</p>
        </div>
        <Button onClick={openAdd}>{v('addVehicle')}</Button>
      </div>

      {/* Toggle archived */}
      <div className="flex gap-2">
        <button
          onClick={() => setShowArchived(false)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            !showArchived ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          {v('active')}
        </button>
        <button
          onClick={() => setShowArchived(true)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            showArchived ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
          }`}
        >
          {v('archived')}
        </button>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>
      ) : displayed.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">{v('noVehicles')}</p>
      ) : (
        <div className="space-y-3">
          {displayed.map(veh => (
            <Card key={veh.id} className="p-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{veh.name}</span>
                    <Badge variant={TYPE_COLORS[veh.vehicle_type] as 'blue' | 'default' | 'amber'}>
                      {v(`type${veh.vehicle_type.charAt(0).toUpperCase() + veh.vehicle_type.slice(1)}`)}
                    </Badge>
                  </div>
                  <div className="text-sm text-gray-500 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                    {veh.license_plate && <span>{veh.license_plate}</span>}
                    {(veh.year || veh.make || veh.model) && (
                      <span>{[veh.year, veh.make, veh.model].filter(Boolean).join(' ')}</span>
                    )}
                    {veh.color && <span>{veh.color}</span>}
                    {veh.assigned_to && <span>{v('assignedTo')}: {veh.assigned_to.full_name}</span>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => openEdit(veh)}>{v(veh.status === 'active' ? 'editVehicle' : 'editVehicle')}</Button>
                  <Button size="sm" variant="ghost" onClick={() => handleArchive(veh)}>
                    {veh.status === 'active' ? v('archiveVehicle') : v('activateVehicle')}
                  </Button>
                  {veh.status === 'archived' && (
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(veh.id)}>✕</Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-4">
          <Card className="w-full max-w-md p-5 space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="font-semibold text-lg">{editing ? v('editVehicle') : v('addVehicleTitle')}</h2>

            <Input
              label={v('vehicleName')}
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder={v('vehicleNamePlaceholder')}
            />

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{v('vehicleType')}</label>
              <div className="flex gap-3">
                {(['company', 'personal', 'rental'] as const).map(type => (
                  <label key={type} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={form.vehicle_type === type}
                      onChange={() => setForm(f => ({ ...f, vehicle_type: type }))}
                    />
                    <span className="text-sm">{v(`type${type.charAt(0).toUpperCase() + type.slice(1)}`)}</span>
                  </label>
                ))}
              </div>
            </div>

            <Input
              label={v('licensePlate')}
              value={form.license_plate}
              onChange={e => setForm(f => ({ ...f, license_plate: e.target.value }))}
              placeholder={v('licensePlatePlaceholder')}
            />

            <div className="grid grid-cols-3 gap-2">
              <Input label={v('year')} type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} placeholder="2024" />
              <Input label={v('make')} value={form.make} onChange={e => setForm(f => ({ ...f, make: e.target.value }))} placeholder="Ford" />
              <Input label={v('model')} value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="F-150" />
            </div>

            <Input
              label={v('color')}
              value={form.color}
              onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
              placeholder="White"
            />

            {employees.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{v('assignedTo')}</label>
                <select
                  value={form.assigned_to_profile_id}
                  onChange={ev => setForm(f => ({ ...f, assigned_to_profile_id: ev.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800"
                >
                  <option value="">{v('unassigned')}</option>
                  {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.full_name}</option>)}
                </select>
              </div>
            )}

            {err && <p className="text-red-500 text-sm">{err}</p>}

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? 'Saving…' : v('saveChanges')}
              </Button>
              <Button variant="ghost" onClick={() => setShowModal(false)} className="flex-1">{t('common.cancel')}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
