// Shared "dashboard period" boundary used by Employee Home and Days, so both
// screens count the same date range for the same company setting
// (company_document_settings.home_period_type) instead of each picking its
// own window.

export type PeriodType = 'weekly' | 'biweekly' | 'monthly'

export function getPeriodRange(periodType: PeriodType, today: Date): { start: Date; end: Date } {
  const start = new Date(today)
  const end = new Date(today)
  if (periodType === 'weekly') {
    start.setDate(today.getDate() - today.getDay())
    start.setHours(0, 0, 0, 0)
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
