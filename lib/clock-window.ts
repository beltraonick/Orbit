// Shared helpers for the optional per-company clock-in/out window feature.
// No timezone library needed — Node/browsers ship full ICU, so Intl with
// an explicit `timeZone` covers everything here.

export interface ClockWindowSettings {
  timezone: string
  enforce_clock_window: boolean
  clock_in_window_start: string // 'HH:MM', company-local time
  clock_in_window_end: string
  clock_out_deadline: string
}

export const DEFAULT_CLOCK_WINDOW: ClockWindowSettings = {
  timezone: 'America/New_York',
  enforce_clock_window: false,
  clock_in_window_start: '07:00',
  clock_in_window_end: '09:00',
  clock_out_deadline: '18:00',
}

export const COMMON_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern Time (New York)' },
  { value: 'America/Chicago', label: 'Central Time (Chicago)' },
  { value: 'America/Denver', label: 'Mountain Time (Denver)' },
  { value: 'America/Phoenix', label: 'Mountain Time — no DST (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska Time (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (Honolulu)' },
]

/** 'HH:MM' and 'YYYY-MM-DD' for an instant, as seen in a given IANA timezone. */
export function localDateTimeParts(instant: Date, timeZone: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(instant).map(p => [p.type, p.value]))
  // Intl can render the hour "24" for midnight in hour12:false — normalize to "00".
  const hour = parts.hour === '24' ? '00' : parts.hour
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${hour}:${parts.minute}` }
}

/** Resolves a wall-clock 'YYYY-MM-DD' + 'HH:MM' in an IANA timezone to a UTC Date. */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [hh, mm] = timeStr.split(':').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0))

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(guess).map(p => [p.type, p.value]))
  const hour = parts.hour === '24' ? '00' : parts.hour
  const asUtcIfLocal = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(hour), Number(parts.minute), Number(parts.second)
  )
  const offset = guess.getTime() - asUtcIfLocal
  return new Date(guess.getTime() + offset)
}

/** true when `time` (HH:MM) falls within [start, end), same-day, no wraparound. */
export function isWithinWindow(time: string, start: string, end: string): boolean {
  return time >= start && time < end
}
