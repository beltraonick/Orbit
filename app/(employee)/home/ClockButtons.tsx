'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { queueIfOffline } from '@/lib/offline-queue'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import {
  localDateTimeParts,
  isWithinWindow,
  haversineDistance,
  addMinutesToTime,
  OVERTIME_PROMPT_GRACE_MINUTES,
  DEFAULT_CLOCK_WINDOW,
  type ClockWindowSettings,
  type JobSite,
} from '@/lib/clock-window'
import { confirmStillWorking } from '@/app/actions/overtimeActions'

interface ClockButtonsProps {
  employeeId: string
  companyId: string
  openEntryId: string | null
  clockInTime: string | null
  // True only for an admin account — the "supervisor" permission alone
  // (kanban access, photo uploads) must not exempt someone from clock-in
  // rules like anyone else.
  bypassClockRules?: boolean
  clockWindow?: ClockWindowSettings
  canSelfClock?: boolean
  geofenceEnabled?: boolean
  jobSites?: JobSite[]
  // True when it's past normal end of day (+ grace) and this entry hasn't
  // confirmed "still working" recently — decided server-side on page load.
  needsOvertimeCheck?: boolean
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

type LocationResult =
  // accuracy: the phone's own error radius in metres (coords.accuracy).
  | { ok: true; latitude: number; longitude: number; accuracy: number; city: string; state: string }
  // 'denied' vs 'unavailable' get different messages to the employee — a
  // permission problem needs a Settings change (and often a full app
  // restart on iOS, which doesn't re-check a permission granted while the
  // page was already open), while a weak GPS signal just needs a retry.
  | { ok: false; reason: 'denied' | 'unavailable' }

// Above this error radius (metres) the phone is only giving an approximate
// position — typically iPhone "Precise Location" turned off.
const IMPRECISE_LOCATION_METERS = 1000

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

function getPosition(options: PositionOptions): Promise<GeolocationPosition | GeolocationPositionError> {
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(resolve, resolve, options)
  })
}

function isPositionError(v: GeolocationPosition | GeolocationPositionError): v is GeolocationPositionError {
  return 'code' in v
}

// fresh: don't reuse a position cached in the last minute — used on "Try
// again" so a phone that just turned on Precise Location isn't handed the
// same old approximate fix.
async function getLocation(fresh = false): Promise<LocationResult> {
  if (!navigator.geolocation) return { ok: false, reason: 'unavailable' }

  // First try: a real GPS fix. Job sites often have weak signal (indoors,
  // trailers), so this gets a generous timeout rather than the 6s that used
  // to make a slow-but-genuine GPS fix look identical to a denied permission.
  const maximumAge = fresh ? 0 : 60000
  let result = await getPosition({ timeout: 15000, enableHighAccuracy: true, maximumAge })

  // A real permission denial (code 1) never succeeds on retry — stop here.
  if (isPositionError(result) && result.code === result.PERMISSION_DENIED) {
    return { ok: false, reason: 'denied' }
  }

  // Timeout or position-unavailable: retry once, network/cell-tower based
  // (enableHighAccuracy: false) instead of GPS — much faster to resolve and
  // plenty precise for a job-site radius check.
  if (isPositionError(result)) {
    result = await getPosition({ timeout: 8000, enableHighAccuracy: false, maximumAge })
  }

  if (isPositionError(result)) {
    return { ok: false, reason: result.code === result.PERMISSION_DENIED ? 'denied' : 'unavailable' }
  }

  const { latitude, longitude } = result.coords
  const accuracy = Number.isFinite(result.coords.accuracy) ? result.coords.accuracy : 0
  // City/state is a nice-to-have: never let a slow or rate-limited
  // geocoder hold up the clock-in itself (it used to wait forever).
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 3000)
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json`,
      { headers: { 'Accept-Language': 'en-US' }, signal: ctrl.signal }
    )
    const data = await res.json()
    const addr = data.address ?? {}
    const city = addr.city ?? addr.town ?? addr.village ?? addr.county ?? ''
    const state = addr.state ?? ''
    return { ok: true, latitude, longitude, accuracy, city, state }
  } catch {
    return { ok: true, latitude, longitude, accuracy, city: '', state: '' }
  } finally {
    clearTimeout(timer)
  }
}

export function ClockButtons({
  employeeId,
  companyId,
  openEntryId,
  clockInTime,
  bypassClockRules = false,
  clockWindow = DEFAULT_CLOCK_WINDOW,
  canSelfClock = true,
  geofenceEnabled = false,
  jobSites = [],
  needsOvertimeCheck = false,
}: ClockButtonsProps) {
  const router = useRouter()
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)
  const [elapsed, setElapsed] = useState('')
  const [locationInfo, setLocationInfo] = useState('')
  const [clockError, setClockError] = useState('')
  const [showOvertimePrompt, setShowOvertimePrompt] = useState(needsOvertimeCheck)
  // 5-second undo window before an overtime answer actually commits — a
  // mistap ("No" meant for a different button, or "Yes" out of habit) is
  // reversible instead of instantly closing the entry or logging a false
  // confirmation.
  const [pendingOvertimeAnswer, setPendingOvertimeAnswer] = useState<{ stillWorking: boolean; timer: ReturnType<typeof setTimeout> } | null>(null)
  // Set when the last clock-in was blocked by the job-site check: drives the
  // distance line, the "How to turn it on" steps and the "Try again" label.
  const [geoProblem, setGeoProblem] = useState<{ imprecise: boolean; distanceM: number; siteName: string } | null>(null)
  const [showSteps, setShowSteps] = useState(false)
  const [nowLocal, setNowLocal] = useState('')

  // Only gates this employee's OWN clock-in — supervisors/admins clocking
  // someone else in via the Team Clock tool are never restricted by this.
  const windowActive = clockWindow.enforce_clock_window && !bypassClockRules

  useEffect(() => {
    if (!windowActive) return
    const tick = () => setNowLocal(localDateTimeParts(new Date(), clockWindow.timezone).time)
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [windowActive, clockWindow.timezone])

  const canClockInNow = !windowActive || !nowLocal || isWithinWindow(nowLocal, clockWindow.clock_in_window_start, clockWindow.clock_in_window_end)

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

  // Re-asks "still working?" every hour on the hour WHILE THE APP STAYS
  // OPEN, not only when it's reopened — so someone who keeps the app open
  // and keeps answering "yes" gets one confirmation per hour (6-7, 7-8, …)
  // instead of just one snapshot from whenever they happened to open it.
  // No server cron involved: this is a client-side timer, so it only runs
  // while the tab/app is actually open and in the foreground (the browser
  // suspends it otherwise) — the page-load check covers the reopen case for
  // when the phone was locked or the app was closed in between.
  const lastOvertimePromptAt = useRef<number>(needsOvertimeCheck ? Date.now() : 0)
  useEffect(() => {
    if (!clockedIn || !clockWindow.enforce_clock_window) return
    const checkHourly = () => {
      if (showOvertimePrompt || pendingOvertimeAnswer) return
      const { time: nowLoc } = localDateTimeParts(new Date(), clockWindow.timezone)
      const promptsFrom = addMinutesToTime(clockWindow.normal_clock_out_time, OVERTIME_PROMPT_GRACE_MINUTES)
      const inWindow = nowLoc >= promptsFrom && nowLoc < clockWindow.clock_out_deadline
      if (!inWindow) return
      const minutesSincePrompt = (Date.now() - lastOvertimePromptAt.current) / 60000
      if (minutesSincePrompt >= 60) {
        lastOvertimePromptAt.current = Date.now()
        setShowOvertimePrompt(true)
      }
    }
    const id = setInterval(checkHourly, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [clockedIn, clockWindow, showOvertimePrompt, pendingOvertimeAnswer])

  if (!canSelfClock) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="w-10 h-10 rounded-full bg-surface-elevated flex items-center justify-center">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-tertiary">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
          </svg>
        </div>
        <p className="text-sm text-secondary text-center px-4">{t('employee.clockButtons.managedBySupervisor')}</p>
      </div>
    )
  }

  async function clockIn() {
    setLoading(true)
    setClockError('')
    setLocationInfo(t('employee.clockButtons.gettingLocation'))

    const loc = await getLocation(geoProblem !== null)
    setGeoProblem(null)
    setLocationInfo(loc.ok && loc.city ? `${loc.city}, ${loc.state}` : '')

    // Geofence check — supervisors/admins bypass (same pattern as clock window).
    if (geofenceEnabled && !bypassClockRules && jobSites.length > 0) {
      if (!loc.ok) {
        setClockError(
          loc.reason === 'denied'
            ? t('employee.clockButtons.locationDenied')
            : t('employee.clockButtons.locationUnavailable')
        )
        setLoading(false)
        return
      }
      const withinSite = jobSites.some(
        s => haversineDistance(loc.latitude, loc.longitude, s.latitude, s.longitude) <= s.radius_meters
      )
      if (!withinSite) {
        // Same rule as before — only the message changes. An error radius
        // this large almost always means iPhone "Precise Location" is off
        // (it blurs the position by kilometres on purpose), so say how to fix
        // that instead of "you're not at the job site".
        const nearest = jobSites
          .map(s => ({ name: s.name, d: haversineDistance(loc.latitude, loc.longitude, s.latitude, s.longitude) }))
          .sort((a, b) => a.d - b.d)[0]
        const imprecise = loc.accuracy > IMPRECISE_LOCATION_METERS
        setGeoProblem({ imprecise, distanceM: nearest.d, siteName: nearest.name })
        setShowSteps(false)
        setClockError(
          imprecise
            ? t('employee.clockButtons.impreciseLocation').replace('{km}', String(Math.max(1, Math.round(loc.accuracy / 1000))))
            : t('employee.clockButtons.notAtJobSite')
        )
        setLoading(false)
        return
      }
    }

    // One clock-in/out cycle per calendar day — clocking in again after
    // already completing one today would let the same day get paid or
    // counted more than once.
    const todayStr = new Date().toISOString().slice(0, 10)
    const { data: alreadyToday } = await createClient()
      .from('time_entries')
      .select('id')
      .eq('employee_id', employeeId)
      .not('clock_out', 'is', null)
      .gte('clock_in', `${todayStr}T00:00:00.000Z`)
      .lt('clock_in', `${todayStr}T23:59:59.999Z`)
      .maybeSingle()
    if (alreadyToday) {
      setClockError(t('employee.clockButtons.alreadyClockedToday'))
      setLoading(false)
      setLocationInfo('')
      return
    }

    const entryId = newId()
    const clockInIso = new Date().toISOString()
    const payload = {
      id: entryId,
      employee_id: employeeId,
      company_id: companyId,
      clock_in: clockInIso,
      ...(loc.ok && {
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
      // No connection: kept in the offline queue and sent later — the
      // optimistic "Clocked in" is right. Any other failure means nothing was
      // saved: undo the optimistic state and say so, never fake a clock-in.
      const queued = await queueIfOffline({ table: 'time_entries', type: 'insert', payload }, err)
      if (!queued) {
        setClockedIn(false)
        setLocalClockInTime(null)
        setLocalEntryId(null)
        setClockError('Clock-in was not saved. Please try again.')
      }
    }

    router.refresh()
    setLoading(false)
    setLocationInfo('')
  }

  async function clockOut() {
    if (!localEntryId || !localClockInTime) return
    setLoading(true)
    // Full vs half day is decided by hours actually worked, not a manual
    // choice — 5+ hours is a full day, less is half.
    const clockOutIso = new Date().toISOString()
    const hoursWorked = (new Date(clockOutIso).getTime() - new Date(localClockInTime).getTime()) / 3600000
    const isFullDay = hoursWorked >= 5
    const payload = { clock_out: clockOutIso, is_full_day: isFullDay }

    setClockedIn(false)
    setLocalClockInTime(null)

    const previousClockIn = localClockInTime
    setClockError('')
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
      const queued = await queueIfOffline({ table: 'time_entries', type: 'update', match: { id: localEntryId }, payload }, err)
      if (!queued) {
        setClockedIn(true)
        setLocalClockInTime(previousClockIn)
        setClockError('Clock-out was not saved. Please try again.')
        setLoading(false)
        return
      }
    }

    setLocalEntryId(null)
    router.refresh()
    setLoading(false)
  }

  // "Still working?" — asked once it's past normal end of day instead of
  // silently assuming either way. No logs them out now; yes records a
  // timestamped, location-checked confirmation and keeps the session open.
  // Neither happens right away: a 5s undo window makes a mistap reversible.
  async function executeOvertimeAnswer(stillWorking: boolean) {
    if (!stillWorking) {
      await clockOut()
      return
    }
    if (!localEntryId) return
    const loc = await getLocation()
    await confirmStillWorking({
      entryId: localEntryId,
      latitude: loc.ok ? loc.latitude : undefined,
      longitude: loc.ok ? loc.longitude : undefined,
    })
  }

  function answerOvertime(stillWorking: boolean) {
    setShowOvertimePrompt(false)
    lastOvertimePromptAt.current = Date.now()
    const timer = setTimeout(() => {
      setPendingOvertimeAnswer(null)
      void executeOvertimeAnswer(stillWorking)
    }, 5000)
    setPendingOvertimeAnswer({ stillWorking, timer })
  }

  function undoOvertimeAnswer() {
    if (!pendingOvertimeAnswer) return
    clearTimeout(pendingOvertimeAnswer.timer)
    setPendingOvertimeAnswer(null)
    setShowOvertimePrompt(true)
  }

  if (clockedIn && showOvertimePrompt) {
    return (
      <div className="flex flex-col items-center gap-4 py-2">
        <p className="text-sm font-medium text-primary text-center">{t('employee.clockButtons.stillWorkingQuestion')}</p>
        <p className="text-lg font-semibold text-tertiary tracking-wide font-mono tabular-nums">{elapsed}</p>
        <div className="flex gap-2 w-full">
          <button
            onClick={() => answerOvertime(true)}
            className="flex-1 py-2.5 rounded-button text-sm font-medium bg-brand text-white"
          >
            {t('employee.clockButtons.stillWorkingYes')}
          </button>
          <button
            onClick={() => answerOvertime(false)}
            className="flex-1 py-2.5 rounded-button text-sm font-medium bg-surface-elevated border border-[var(--border)] text-secondary"
          >
            {t('employee.clockButtons.stillWorkingNo')}
          </button>
        </div>
      </div>
    )
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

        {clockError && <p className="text-sm text-danger text-center">{clockError}</p>}

        {pendingOvertimeAnswer && (
          <div className="w-full flex items-center justify-between px-4 py-3 rounded-card bg-surface-elevated border border-[var(--border)] shadow-sm">
            <p className="text-sm text-secondary">
              {t(pendingOvertimeAnswer.stillWorking ? 'employee.clockButtons.stillWorkingYesSaved' : 'employee.clockButtons.stillWorkingNoSaved')}
            </p>
            <button onClick={undoOvertimeAnswer} className="text-sm font-semibold text-brand hover:text-brand/80 transition-colors">
              {t('common.undo')}
            </button>
          </div>
        )}

        <Button variant="danger" size="lg" onClick={clockOut} loading={loading} className="w-full mt-1">
          {t('employee.clockButtons.clockOut')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <p className="text-sm text-secondary">{t('employee.clockButtons.notClockedIn')}</p>
      {clockError && (
        <p className="text-sm text-danger text-center">{clockError}</p>
      )}
      {geoProblem && (
        <p className="text-xs text-secondary text-center">
          {t(geoProblem.imprecise ? 'employee.clockButtons.distanceToSiteApprox' : 'employee.clockButtons.distanceToSite')
            .replace('{dist}', formatDistance(geoProblem.distanceM))
            .replace('{name}', geoProblem.siteName)}
        </p>
      )}
      {geoProblem?.imprecise && (
        <div className="w-full">
          <button
            type="button"
            onClick={() => setShowSteps(v => !v)}
            className="w-full h-10 rounded-button border border-brand/40 text-brand text-sm font-semibold bg-brand/5"
          >
            {showSteps ? t('employee.clockButtons.hideSteps') : `📍 ${t('employee.clockButtons.howToEnable')}`}
          </button>
          {showSteps && (
            <div className="mt-2 rounded-card border border-[var(--border)] bg-surface-elevated p-3 text-left text-xs text-primary space-y-2">
              <p className="font-semibold">{t('employee.clockButtons.stepsIphoneTitle')}</p>
              <ol className="list-decimal pl-5 space-y-1 text-secondary">
                {[1, 2, 3, 4, 5].map(n => <li key={n}>{t(`employee.clockButtons.stepsIphone${n}`)}</li>)}
              </ol>
              <p className="font-semibold pt-1">{t('employee.clockButtons.stepsAndroidTitle')}</p>
              <ul className="list-disc pl-5 space-y-1 text-secondary">
                <li>{t('employee.clockButtons.stepsAndroid1')}</li>
                <li>{t('employee.clockButtons.stepsAndroid2')}</li>
              </ul>
              <p className="font-semibold pt-1">{t('employee.clockButtons.stepsAlsoTitle')}</p>
              <ul className="list-disc pl-5 space-y-1 text-secondary">
                <li>{t('employee.clockButtons.stepsAlsoWifiBluetooth')}</li>
                <li>{t('employee.clockButtons.stepsAlsoMaps')}</li>
              </ul>
            </div>
          )}
        </div>
      )}
      {locationInfo && (
        <p className="text-xs text-secondary flex items-center gap-1.5">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-brand">
            <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
          </svg>
          {locationInfo}
        </p>
      )}
      {!canClockInNow && (
        <p className="text-xs text-amber text-center">
          Clock-in is only available between {clockWindow.clock_in_window_start} and {clockWindow.clock_in_window_end}.
        </p>
      )}
      <Button size="lg" onClick={clockIn} loading={loading} disabled={!canClockInNow} className="w-full">
        {geoProblem ? t('employee.clockButtons.tryAgain') : t('employee.clockButtons.clockIn')}
      </Button>
    </div>
  )
}
