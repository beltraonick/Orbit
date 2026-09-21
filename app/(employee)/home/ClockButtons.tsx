'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { queueIfOffline } from '@/lib/offline-queue'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/lib/i18n/LocaleContext'

interface ClockButtonsProps {
  employeeId: string
  companyId: string
  openEntryId: string | null
  clockInTime: string | null
}

function formatElapsed(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  const h = Math.floor(diff / 3600)
  const m = Math.floor((diff % 3600) / 60)
  const s = diff % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

async function getLocation() {
  return new Promise<{ latitude: number; longitude: number; city: string; state: string } | null>(resolve => {
    if (!navigator.geolocation) { resolve(null); return }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude, longitude } = pos.coords
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
            { headers: { 'Accept-Language': 'en-US' } }
          )
          const data = await res.json()
          const addr = data.address ?? {}
          const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? ''
          const state = addr.state ?? ''
          resolve({ latitude, longitude, city, state })
        } catch {
          resolve({ latitude, longitude, city: '', state: '' })
        }
      },
      () => resolve(null),
      { timeout: 8000, enableHighAccuracy: true }
    )
  })
}

export function ClockButtons({ employeeId, companyId, openEntryId, clockInTime }: ClockButtonsProps) {
  const router = useRouter()
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState('')
  const [locationInfo, setLocationInfo] = useState('')
  const [confirmingOut, setConfirmingOut] = useState(false)

  // Optimistic local state — lets clock in/out work instantly even
  // offline, without waiting on (or depending on) a server round-trip.
  const [clockedIn, setClockedIn] = useState(!!clockInTime)
  const [localClockInTime, setLocalClockInTime] = useState(clockInTime)
  const [localEntryId, setLocalEntryId] = useState(openEntryId)

  useEffect(() => {
    if (!localClockInTime) return
    const tick = () => setElapsed(formatElapsed(localClockInTime))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [localClockInTime])

  async function clockIn() {
    setLoading(true)
    setLocationInfo(t('employee.clockButtons.gettingLocation'))

    const loc = await getLocation()
    setLocationInfo(loc?.city ? `${loc.city}, ${loc.state}` : '')

    const entryId = newId()
    const clockInIso = new Date().toISOString()
    const payload = {
      id: entryId,
      employee_id: employeeId,
      company_id: companyId,
      clock_in: clockInIso,
      ...(loc && {
        latitude: loc.latitude,
        longitude: loc.longitude,
        city: loc.city,
        state: loc.state,
      }),
    }

    // Optimistic: reflect clocked-in state immediately, regardless of network.
    setClockedIn(true)
    setLocalClockInTime(clockInIso)
    setLocalEntryId(entryId)

    try {
      const supabase = createClient()
      const { error } = await supabase.from('time_entries').insert(payload)
      if (error) throw error
    } catch (err) {
      await queueIfOffline({ table: 'time_entries', type: 'insert', payload }, err)
    }

    router.refresh()
    setLoading(false)
    setLocationInfo('')
  }

  async function clockOut(isFullDay: boolean) {
    if (!localEntryId) return
    setLoading(true)
    setConfirmingOut(false)
    const payload = { clock_out: new Date().toISOString(), is_full_day: isFullDay }

    setClockedIn(false)
    setLocalClockInTime(null)

    try {
      const supabase = createClient()
      const { error } = await supabase.from('time_entries').update(payload).eq('id', localEntryId)
      if (error) throw error
      // Fire-and-forget QBO sync — never blocks clock out, never surfaces errors to the employee
      fetch('/api/qbo/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ time_entry_id: localEntryId }),
      }).catch(() => {})
    } catch (err) {
      await queueIfOffline({ table: 'time_entries', type: 'update', match: { id: localEntryId }, payload }, err)
    }

    setLocalEntryId(null)
    router.refresh()
    setLoading(false)
  }

  if (clockedIn) {
    return (
      <div className="flex flex-col items-center gap-4 py-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green animate-pulse" />
          <span className="text-sm text-green font-medium">{t('employee.clockButtons.clockedIn')}</span>
        </div>
        {localClockInTime && (
          <p className="text-sm text-secondary">
            {t('employee.clockButtons.sinceLabel')} {new Date(localClockInTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        <p className="text-lg font-semibold text-tertiary tracking-wide font-mono tabular-nums">{elapsed}</p>

        {!confirmingOut ? (
          <Button variant="danger" size="lg" onClick={() => setConfirmingOut(true)} loading={loading} className="w-full mt-1">
            {t('employee.clockButtons.clockOut')}
          </Button>
        ) : (
          <div className="w-full flex flex-col gap-2 mt-1">
            <p className="text-xs font-medium text-secondary text-center">{t('supervisor.clockIn.fullDayQuestion')}</p>
            <div className="flex gap-2 w-full">
              <button
                onClick={() => clockOut(true)}
                disabled={loading}
                className="flex-1 py-2.5 rounded-button text-sm font-medium bg-brand text-white disabled:opacity-50"
              >
                {t('supervisor.clockIn.fullDay')}
              </button>
              <button
                onClick={() => clockOut(false)}
                disabled={loading}
                className="flex-1 py-2.5 rounded-button text-sm font-medium bg-amber text-white disabled:opacity-50"
              >
                {t('supervisor.clockIn.partialDay')}
              </button>
            </div>
            <button onClick={() => setConfirmingOut(false)} disabled={loading} className="text-xs text-secondary underline">
              {t('common.cancel')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <p className="text-sm text-secondary">{t('employee.clockButtons.notClockedIn')}</p>
      {locationInfo && (
        <p className="text-xs text-secondary flex items-center gap-1.5">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-brand">
            <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
          </svg>
          {locationInfo}
        </p>
      )}
      <Button size="lg" onClick={clockIn} loading={loading} className="w-full">
        {t('employee.clockButtons.clockIn')}
      </Button>
    </div>
  )
}
