'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useCompanyId } from '@/lib/company-context'
import { createClient } from '@/lib/supabase/client'

interface JobSiteRow {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_meters: number
  active: boolean
}

const DEFAULT_RADIUS = 200

export default function JobSitesPage() {
  const companyId = useCompanyId()
  const router = useRouter()

  const [sites, setSites] = useState<JobSiteRow[]>([])
  const [loading, setLoading] = useState(true)

  // New site form
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [radius, setRadius] = useState(String(DEFAULT_RADIUS))
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)
  const [gettingLocation, setGettingLocation] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [suggestions, setSuggestions] = useState<{ label: string; lat: number; lng: number }[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Inline radius editing
  const [editingRadiusId, setEditingRadiusId] = useState<string | null>(null)
  const [editingRadiusValue, setEditingRadiusValue] = useState('')
  const [savingRadiusId, setSavingRadiusId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('job_sites')
      .select('id, name, latitude, longitude, radius_meters, active')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
    setSites(data ?? [])
    setLoading(false)
  }, [companyId])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setAddError('')
    const latNum = parseFloat(lat)
    const lngNum = parseFloat(lng)
    const radiusNum = parseInt(radius, 10)
    if (!name.trim()) { setAddError('Name is required.'); return }
    if (isNaN(latNum) || isNaN(lngNum)) { setAddError('Search for an address or use your current location first.'); return }
    if (isNaN(radiusNum) || radiusNum < 10 || radiusNum > 50000) { setAddError('Radius must be between 10 and 50 000 metres.'); return }

    setAdding(true)
    const supabase = createClient()
    const { error } = await supabase.from('job_sites').insert({
      company_id: companyId,
      name: name.trim(),
      latitude: latNum,
      longitude: lngNum,
      radius_meters: radiusNum,
      active: true,
    })
    setAdding(false)
    if (error) { setAddError('Could not save. Please try again.'); return }
    setName(''); setAddress(''); setLat(''); setLng(''); setRadius(String(DEFAULT_RADIUS))
    load()
  }

  function onAddressChange(value: string) {
    setAddress(value)
    setLat('')
    setLng('')
    setSuggestions([])
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    if (value.trim().length < 3) { setShowSuggestions(false); return }
    suggestTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(value.trim())}&limit=5&lang=en`
        )
        const data = await res.json()
        const items = (data.features ?? []).map((f: { geometry: { coordinates: [number, number] }; properties: { name?: string; street?: string; housenumber?: string; city?: string; state?: string; country?: string } }) => {
          const p = f.properties
          const parts = [p.name, p.street && p.housenumber ? `${p.street} ${p.housenumber}` : p.street, p.city, p.state, p.country].filter(Boolean)
          return { label: parts.join(', '), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }
        })
        setSuggestions(items)
        setShowSuggestions(items.length > 0)
      } catch { /* ignore */ }
    }, 350)
  }

  function pickSuggestion(s: { label: string; lat: number; lng: number }) {
    setAddress(s.label)
    setLat(s.lat.toFixed(7))
    setLng(s.lng.toFixed(7))
    setSuggestions([])
    setShowSuggestions(false)
  }

  async function geocodeAddress() {
    if (!address.trim()) { setAddError('Enter an address to search.'); return }
    setGeocoding(true)
    setAddError('')
    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(address.trim())}&limit=1&lang=en`
      )
      const data = await res.json()
      if (!data.features?.length) { setAddError('Address not found. Try a more specific address.'); setGeocoding(false); return }
      const f = data.features[0]
      setLat(f.geometry.coordinates[1].toFixed(7))
      setLng(f.geometry.coordinates[0].toFixed(7))
    } catch {
      setAddError('Could not search for address. Check your connection.')
    }
    setGeocoding(false)
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setAddError('Geolocation not supported on this device.'); return }
    setGettingLocation(true)
    setAddError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude.toFixed(7))
        setLng(pos.coords.longitude.toFixed(7))
        setAddress('')
        setGettingLocation(false)
      },
      () => { setAddError('Could not get your location. Please try entering an address.'); setGettingLocation(false) },
      { timeout: 10000, enableHighAccuracy: true }
    )
  }

  async function toggleActive(id: string, active: boolean) {
    const supabase = createClient()
    await supabase.from('job_sites').update({ active: !active }).eq('id', id)
    setSites(prev => prev.map(s => s.id === id ? { ...s, active: !active } : s))
  }

  async function saveRadius(id: string) {
    const r = parseInt(editingRadiusValue, 10)
    if (isNaN(r) || r < 10 || r > 50000) return
    setSavingRadiusId(id)
    const supabase = createClient()
    await supabase.from('job_sites').update({ radius_meters: r }).eq('id', id)
    setSites(prev => prev.map(s => s.id === id ? { ...s, radius_meters: r } : s))
    setSavingRadiusId(null)
    setEditingRadiusId(null)
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this job site? This cannot be undone.')) return
    const supabase = createClient()
    await supabase.from('job_sites').delete().eq('id', id)
    setSites(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6 md:py-8">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push('/admin/settings')}
          className="p-1.5 rounded-button text-secondary hover:text-primary hover:bg-surface-elevated transition-colors"
          aria-label="Back"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-primary">Job Sites</h1>
      </div>

      {/* Add new site */}
      <Card className="mb-5">
        <h2 className="text-sm font-semibold text-primary mb-3">Add a Job Site</h2>
        <form onSubmit={handleAdd} className="space-y-3">
          <Input
            label="Site Name"
            placeholder="e.g. Main Street Project"
            value={name}
            onChange={e => setName(e.target.value)}
          />

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-secondary">Address</label>
            <div className="relative">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={address}
                  onChange={e => onAddressChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); if (!lat) geocodeAddress() }
                    if (e.key === 'Escape') setShowSuggestions(false)
                  }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  placeholder="e.g. Hampton Inn Beckley, WV"
                  className="h-11 flex-1 rounded-input bg-surface-elevated border border-[var(--border)] px-4 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60 transition-colors"
                />
                {!lat && (
                  <button
                    type="button"
                    onClick={geocodeAddress}
                    disabled={geocoding || !address.trim()}
                    className="h-11 px-4 rounded-input bg-brand text-white text-sm font-medium disabled:opacity-50 transition-opacity flex-shrink-0"
                  >
                    {geocoding ? '…' : 'Search'}
                  </button>
                )}
              </div>
              {showSuggestions && (
                <ul className="absolute z-10 top-full left-0 right-0 mt-1 bg-surface-elevated border border-[var(--border)] rounded-card shadow-lg overflow-hidden">
                  {suggestions.map((s, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onMouseDown={() => pickSuggestion(s)}
                        className="w-full text-left px-4 py-2.5 text-sm text-primary hover:bg-surface-subtle flex items-start gap-2"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-brand flex-shrink-0 mt-0.5">
                          <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                        </svg>
                        <span className="truncate">{s.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {lat && lng && (
              <p className="text-xs text-secondary">
                📍 {parseFloat(lat).toFixed(5)}, {parseFloat(lng).toFixed(5)}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={useMyLocation}
            disabled={gettingLocation}
            className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline disabled:opacity-50"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
            </svg>
            {gettingLocation ? 'Getting location…' : 'Use my current location'}
          </button>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-secondary">
              Radius (metres)
            </label>
            <input
              type="number"
              min={10}
              max={50000}
              value={radius}
              onChange={e => setRadius(e.target.value)}
              className="h-11 w-full rounded-input bg-surface-elevated border border-[var(--border)] px-4 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60 transition-colors"
            />
            <p className="text-xs text-secondary">
              {parseInt(radius, 10) > 0
                ? `Employees must be within ${parseInt(radius, 10)} m (~${Math.round(parseInt(radius, 10) * 3.28)}  ft) to clock in.`
                : 'How close employees must be to clock in.'}
            </p>
          </div>

          {addError && <p className="text-xs text-danger">{addError}</p>}

          <Button type="submit" loading={adding} disabled={adding || gettingLocation}>
            Add Site
          </Button>
        </form>
      </Card>

      {/* Site list */}
      <h2 className="text-sm font-semibold text-primary mb-3">Existing Sites</h2>
      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className="h-16 bg-surface-elevated rounded-card animate-pulse" />
          ))}
        </div>
      ) : sites.length === 0 ? (
        <Card>
          <p className="text-sm text-secondary text-center py-4">No job sites added yet.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {sites.map(site => (
            <Card key={site.id} padding="sm">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-primary truncate">{site.name}</span>
                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${site.active ? 'bg-green' : 'bg-tertiary'}`} />
                  </div>
                  <p className="text-xs text-secondary mt-0.5">
                    {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)}
                  </p>
                  {editingRadiusId === site.id ? (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <input
                        type="number"
                        min={10}
                        max={50000}
                        value={editingRadiusValue}
                        onChange={e => setEditingRadiusValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveRadius(site.id); if (e.key === 'Escape') setEditingRadiusId(null) }}
                        className="h-8 w-24 rounded-input bg-surface border border-[var(--border)] px-2 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-brand/40"
                        autoFocus
                      />
                      <span className="text-xs text-secondary">m</span>
                      <button onClick={() => saveRadius(site.id)} disabled={savingRadiusId === site.id} className="text-xs text-brand hover:underline disabled:opacity-50">
                        {savingRadiusId === site.id ? '…' : 'Save'}
                      </button>
                      <button onClick={() => setEditingRadiusId(null)} className="text-xs text-secondary hover:underline">Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingRadiusId(site.id); setEditingRadiusValue(String(site.radius_meters)) }}
                      className="text-xs text-secondary hover:text-primary mt-1"
                    >
                      {site.radius_meters} m radius · <span className="underline">Edit</span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => toggleActive(site.id, site.active)}
                    className="text-xs text-secondary hover:text-primary underline"
                  >
                    {site.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    onClick={() => handleDelete(site.id)}
                    className="text-xs text-danger hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
