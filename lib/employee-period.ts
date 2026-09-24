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
//
// "Pay period" on every screen is the period being PAID, not simply the
// calendar cycle we're in (see getPayPeriodRange): the oldest cycle that has
// already ended and hasn't been finalized yet in Payroll. Once the admin
// finalizes it (= marks it paid), every screen moves on to the next one.

export type PeriodType = 'weekly' | 'biweekly' | 'monthly'

export interface CompanyPeriodSettings {
  periodType: PeriodType
  anchor: string | null // YYYY-MM-DD
  lag: number // legacy fixed delay (migration 046) — superseded by `paid`, no longer applied
  paid: { start: string; end: string }[] // finalized (= paid) payroll periods, YYYY-MM-DD
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

// How far back an unpaid, already-ended cycle is still shown as "the period
// being paid". Older unpaid cycles are treated as settled outside the app
// (e.g. paid before the company started using Finalize), so a company that
// never finalizes doesn't get stuck showing a months-old period.
const MAX_UNPAID_LOOKBACK = 2

function isPaid(r: { start: Date; end: Date }, paid: { start: string; end: string }[]): boolean {
  const s = toDateStr(r.start), e = toDateStr(r.end)
  return paid.some(p => p.start <= s && p.end >= e)
}

/**
 * The period employees are about to be paid for — what "Pay Period" means on
 * Home, Hours, Pay, Admin Payroll and Time:
 *   1. the oldest cycle (up to MAX_UNPAID_LOOKBACK back, and after the
 *      latest finalized one) that already ended and isn't finalized yet;
 *   2. otherwise the cycle in progress;
 *   3. unless that one was finalized early too — then the next one.
 * A company with no anchor date and nothing ever finalized keeps the plain
 * calendar cycle, exactly as before.
 */
export function getPayPeriodRange(settings: CompanyPeriodSettings, today: Date = new Date()): { start: Date; end: Date } {
  const { periodType, anchor, paid } = settings
  const current = getPeriodRange(periodType, today, anchor)
  if (!anchor && paid.length === 0) return current

  const anchorStart = anchor ? toDateStr(parseDateStr(anchor) ?? today) : null
  // Payroll is paid in order: anything that ended on or before the latest
  // finalized period is settled, even if it was never finalized itself.
  const lastPaidEnd = paid.reduce<string | null>((m, p) => (m === null || p.end > m ? p.end : m), null)
  const older: { start: Date; end: Date }[] = []
  let cursor = current
  for (let i = 0; i < MAX_UNPAID_LOOKBACK; i++) {
    const dayBefore = new Date(cursor.start)
    dayBefore.setDate(dayBefore.getDate() - 1)
    cursor = getPeriodRange(periodType, dayBefore, anchor)
    if (anchorStart && toDateStr(cursor.start) < anchorStart) break // before the company's first cycle
    if (lastPaidEnd && toDateStr(cursor.end) <= lastPaidEnd) break // already settled
    older.unshift(cursor)
  }
  const unpaid = older.find(r => !isPaid(r, paid))
  if (unpaid) return unpaid
  if (!isPaid(current, paid)) return current
  const dayAfter = new Date(current.end)
  dayAfter.setDate(dayAfter.getDate() + 1)
  return getPeriodRange(periodType, dayAfter, anchor)
}

/** The period right before the one being paid ("Last Pay Period"). */
export function getPreviousPayPeriodRange(settings: CompanyPeriodSettings, today: Date = new Date()): { start: Date; end: Date } {
  const paying = getPayPeriodRange(settings, today)
  const dayBefore = new Date(paying.start)
  dayBefore.setDate(dayBefore.getDate() - 1)
  return getPeriodRange(settings.periodType, dayBefore, settings.anchor)
}

/** True when the pay period has already ended and is waiting to be paid. */
export function isAwaitingPayment(range: { end: Date }, today: Date = new Date()): boolean {
  return toDateStr(range.end) < toDateStr(today)
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
  const fallback: CompanyPeriodSettings = { periodType: 'biweekly', anchor: null, lag: 0, paid: [] }
  if (!companyId) return fallback
  try {
    const [{ data }, paid] = await Promise.all([
      supabase
        .from('company_document_settings')
        .select('*')
        .eq('company_id', companyId)
        .maybeSingle(),
      loadPaidPeriods(supabase, companyId),
    ])
    if (!data) return { ...fallback, paid }
    const t = data.home_period_type
    const periodType: PeriodType = t === 'weekly' || t === 'monthly' ? t : 'biweekly'
    const anchor = typeof data.pay_period_anchor === 'string' ? data.pay_period_anchor.slice(0, 10) : null
    const lag = Number.isInteger(data.pay_period_lag) && data.pay_period_lag >= 0 ? data.pay_period_lag : 0
    return { periodType, anchor, lag, paid }
  } catch {
    return fallback
  }
}

// Finalized payroll periods (Payroll -> Finalize Payroll = paid). If this
// can't be read, returns [] — screens then show the calendar cycle instead
// of failing.
async function loadPaidPeriods(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  companyId: string,
): Promise<{ start: string; end: string }[]> {
  try {
    const { data, error } = await supabase
      .from('payroll_periods')
      .select('period_start, period_end')
      .eq('company_id', companyId)
      .order('period_end', { ascending: false })
      .limit(24)
    if (error || !data) return []
    return (data as { period_start: string; period_end: string }[]).map(p => ({
      start: String(p.period_start).slice(0, 10),
      end: String(p.period_end).slice(0, 10),
    }))
  } catch {
    return []
  }
}
