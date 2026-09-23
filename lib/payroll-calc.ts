// Single source of truth for turning one time_entries row into a dollar
// amount. Used by PayrollManager.tsx (the Admin Payroll page), the
// /admin/reports XLSX/PDF export pipeline, and anywhere else that needs to
// show "how much did this entry pay" — so every surface agrees on the same
// number for the same entry, instead of each screen re-deriving its own
// formula (which is how Admin Payroll and Reports/XLSX drifted apart).
//
// Pay mode is per-person, not per-company: whoever has a daily_rate > 0 is
// paid by the day (Full Day = 1x rate, anything else = half rate); everyone
// else is paid hourly_rate x actual hours. This mirrors how profiles and
// workers already store rates (daily_rate / hourly_rate side by side) and
// lets one company mix day-rate crew with hourly crew, which is how real
// construction payrolls actually work.

export const STANDARD_DAY_HOURS = 8

export interface PayRateInput {
  daily_rate: number | null | undefined
  hourly_rate: number | null | undefined
}

export interface PayEntryInput extends PayRateInput {
  clock_in: string
  clock_out: string | null
  hours_worked: number | null
  is_full_day: boolean | null
}

export interface PayEntryResult {
  payMode: 'daily' | 'hourly'
  dailyRate: number
  hourlyRate: number
  hoursWorked: number | null
  fullDay: boolean
  totalPay: number
  overtimeHours: number
  overtimePay: number
}

/** true when this person is paid a daily rate (a positive daily_rate wins over hourly_rate). */
export function isDailyPayMode(rates: PayRateInput): boolean {
  const dailyRate = rates.daily_rate != null ? Number(rates.daily_rate) : null
  return dailyRate != null && dailyRate > 0
}

export function calcEntryPay(entry: PayEntryInput): PayEntryResult {
  const isDailyMode = isDailyPayMode(entry)
  const dailyRate = isDailyMode ? Number(entry.daily_rate) : 0
  const hourlyRate = !isDailyMode ? Number(entry.hourly_rate ?? 0) : 0

  const hours = entry.hours_worked != null ? Number(entry.hours_worked) : null

  const fullDay = isDailyMode
    ? (entry.is_full_day === true || (entry.is_full_day === null && (hours == null || hours >= STANDARD_DAY_HOURS)))
    : false

  let totalPay: number
  if (isDailyMode) {
    totalPay = fullDay ? dailyRate : dailyRate * 0.5
  } else {
    const actualHours = hours != null
      ? hours
      : entry.clock_out
        ? (new Date(entry.clock_out).getTime() - new Date(entry.clock_in).getTime()) / 3600000
        : 0
    totalPay = actualHours * hourlyRate
  }

  // Overtime only applies to daily-rate people (hours logged beyond a standard day).
  const overtimeHours = isDailyMode && hours != null && hours > STANDARD_DAY_HOURS
    ? hours - STANDARD_DAY_HOURS
    : 0
  const hourlyEquiv = dailyRate / STANDARD_DAY_HOURS
  const overtimePay = overtimeHours * hourlyEquiv * 1.5

  return {
    payMode: isDailyMode ? 'daily' : 'hourly',
    dailyRate,
    hourlyRate,
    hoursWorked: hours,
    fullDay,
    totalPay,
    overtimeHours,
    overtimePay,
  }
}
