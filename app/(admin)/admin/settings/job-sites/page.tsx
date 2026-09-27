'use client'

import { useState, useEffect, useCallback } from 'react'
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

  async function geocodeAddress() {
    if (!address.trim()) { setAddError('Enter an address to search.'); return }
    setGeocoding(true)
    setAddError('')
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address.trim())}&format=json&limit=1`,
        { headers: { 'Accept-Language': 'en' } }
      )
      const data = await res.json()
      if (!data.length) { setAddError('Address not found. Try a more specific address.'); setGeocoding(false); return }
      setLat(parseFloat(data[0].lat).toFixed(7))
      setLng(parseFloat(data[0].lon).toFixed(7))
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
            <div className="flex gap-2">
              <input
                type="text"
                value={address}
                onChange={e => { setAddress(e.target.value); setLat(''); setLng('') }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); geocodeAddress() } }}
                placeholder="e.g. 123 Main St, Beckley, WV"
                className="h-11 flex-1 rounded-input bg-surface-elevated border border-[var(--border)] px-4 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60 transition-colors"
              />
              <button
                type="button"
                onClick={geocodeAddress}
                disabled={geocoding || !address.trim()}
                className="h-11 px-4 rounded-input bg-brand text-white text-sm font-medium disabled:opacity-50 transition-opacity flex-shrink-0"
              >
                {geocoding ? '…' : 'Search'}
              </button>
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
                    {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)} · {site.radius_meters} m radius
                  </p>
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
