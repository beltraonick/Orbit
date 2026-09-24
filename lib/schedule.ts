// Days off: pure helpers shared by the server actions and the screens.
//
// Whether someone is off on a date is decided in this order:
//   1. a schedule_overrides row for that exact date (is_off true/false), else
//   2. their fixed weekly days off (profiles.weekly_days_off, 0 = Sunday).
// See migration 048.

/** Day of week (0 = Sunday … 6 = Saturday) of a 'YYYY-MM-DD' date, timezone-free. */
export function dayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** 'YYYY-MM-DD' plus `n` days, timezone-free. */
export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + n))
  return date.toISOString().slice(0, 10)
}

/** The Sunday that starts the week containing `dateStr`. */
export function weekStartOf(dateStr: string): string {
  return addDays(dateStr, -dayOfWeek(dateStr))
}

export function isValidDateStr(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/** Normalizes whatever is stored in profiles.weekly_days_off into a sorted list of 0–6. */
export function normalizeWeeklyDaysOff(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const days = value.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 6)
  return Array.from(new Set(days)).sort((a, b) => a - b)
}

/** true when the fixed weekly schedule alone makes `dateStr` a day off. */
export function isFixedDayOff(weeklyDaysOff: number[], dateStr: string): boolean {
  return weeklyDaysOff.includes(dayOfWeek(dateStr))
}

/** Final answer for one person and one date: override first, then the fixed schedule. */
export function isDayOff(weeklyDaysOff: number[], override: boolean | undefined, dateStr: string): boolean {
  if (override !== undefined) return override
  return isFixedDayOff(weeklyDaysOff, dateStr)
}

// Late clock-in alert: after this company-local time, an employee who is
// working today and hasn't clocked in is flagged. It's 9:00 AM (what the
// company asked for), unless the company turned on its own clock-in window
// in Settings, in which case the end of that window is used instead.
export const DEFAULT_LATE_CUTOFF = '09:00'
