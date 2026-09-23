// Single source of truth for the company's pay period, used by Admin Payroll
// ("Last / Current Pay Period"), Employee Home, Days and Pay, so every screen
// shows the same date range for the same company setting
// (company_document_settings.home_period_type + pay_period_anchor).
//
// Without an anchor date the long-standing behavior is kept:
//   weekly   = Sunday – Saturday
//   biweekly = 1st–15th / 16th–end of month
//   monthly  = 1st – last day
// With an anchor date (e.g. 2026-09-05), weekly/biweekly become real 7/14-day
// cycles starting on that date: Sep 5–18, Sep 19–Oct 2, … — which is how
// companies that pay every other Friday actually run payroll.

export type PeriodType = 'weekly' | 'biweekly' | 'monthly'

export interface CompanyPeriodSettings {
  periodType: PeriodType
  anchor: string | null // YYYY-MM-DD
  lag: number // periods to go back before calling a cycle "current" — see getPeriodRange
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Local calendar date as YYYY-MM-DD (never shifted by UTC conversion). */
export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDateStr(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** `today`, moved back `lag` whole periods — so "current" can mean "the period
 *  actually being paid" for a company that pays on a delay, without anyone
 *  having to hand-edit the anchor date every cycle. */
function shiftByLag(periodType: PeriodType, today: Date, lag: number): Date {
  if (!lag) return today
  const shifted = new Date(today)
  if (periodType === 'weekly') shifted.setDate(shifted.getDate() - lag * 7)
  else if (periodType === 'biweekly') shifted.setDate(shifted.getDate() - lag * 14)
  else shifted.setMonth(shifted.getMonth() - lag)
  return shifted
}

export function getPeriodRange(
  periodType: PeriodType,
  today: Date,
  anchor?: string | null,
  lag = 0,
): { start: Date; end: Date } {
  today = shiftByLag(periodType, today, lag)
  const anchorDate = anchor ? parseDateStr(anchor) : null
  if (anchorDate && (periodType === 'weekly' || periodType === 'biweekly')) {
    const len = periodType === 'weekly' ? 7 : 14
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    // Whole days between anchor and today; round() absorbs DST hour shifts.
    const diff = Math.round((day.getTime() - anchorDate.getTime()) / DAY_MS)
    const cycles = Math.floor(diff / len)
    const start = new Date(anchorDate)
    start.setDate(anchorDate.getDate() + cycles * len)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(start.getDate() + len - 1)
    end.setHours(23, 59, 59, 999)
    return { start, end }
  }

  const start = new Date(today)
  const end = new Date(today)
  if (periodType === 'weekly') {
    start.setDate(today.getDate() - today.getDay())
    start.setHours(0, 0, 0, 0)
    end.setTime(start.getTime())
    end.setDate(start.getDate() + 6)
    end.setHours(23, 59, 59, 999)
  } else if (periodType === 'biweekly') {
    const day = today.getDate()
    if (day <= 15) {
      start.setDate(1)
      end.setDate(15)
    } else {
      start.setDate(16)
      end.setMonth(end.getMonth() + 1, 0) // last day of this month
    }
    start.setHours(0, 0, 0, 0)
    end.setHours(23, 59, 59, 999)
  } else {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    end.setMonth(end.getMonth() + 1, 0)
    end.setHours(23, 59, 59, 999)
  }
  return { start, end }
}

/** The period immediately before the one containing `today`. */
export function getPreviousPeriodRange(
  periodType: PeriodType,
  today: Date,
  anchor?: string | null,
  lag = 0,
): { start: Date; end: Date } {
  const current = getPeriodRange(periodType, today, anchor, lag)
  const dayBefore = new Date(current.start)
  dayBefore.setDate(dayBefore.getDate() - 1)
  return getPeriodRange(periodType, dayBefore, anchor)
}

// Reads the company's period setting. Uses select('*') on purpose: if a
// column is missing in a given database (e.g. pay_period_anchor before its
// migration has run), this still works and falls back to the defaults
// instead of failing the whole screen.
export async function loadCompanyPeriodSettings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  companyId: string | null | undefined,
): Promise<CompanyPeriodSettings> {
  const fallback: CompanyPeriodSettings = { periodType: 'biweekly', anchor: null, lag: 0 }
  if (!companyId) return fallback
  try {
    const { data } = await supabase
      .from('company_document_settings')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle()
    if (!data) return fallback
    const t = data.home_period_type
    const periodType: PeriodType = t === 'weekly' || t === 'monthly' ? t : 'biweekly'
    const anchor = typeof data.pay_period_anchor === 'string' ? data.pay_period_anchor.slice(0, 10) : null
    const lag = Number.isInteger(data.pay_period_lag) && data.pay_period_lag >= 0 ? data.pay_period_lag : 0
    return { periodType, anchor, lag }
  } catch {
    return fallback
  }
}
