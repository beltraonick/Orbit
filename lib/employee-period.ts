// Shared "dashboard period" boundary used by Employee Home and Days, so both
// screens count the same date range for the same company setting
// (company_document_settings.home_period_type) instead of each picking its
// own window.

export type PeriodType = 'weekly' | 'biweekly' | 'monthly'

export function getPeriodRange(periodType: PeriodType, today: Date): { start: Date } {
  const start = new Date(today)
  if (periodType === 'weekly') {
    start.setDate(today.getDate() - today.getDay())
    start.setHours(0, 0, 0, 0)
  } else if (periodType === 'biweekly') {
    const day = today.getDate()
    start.setDate(day <= 15 ? 1 : 16)
    start.setHours(0, 0, 0, 0)
  } else {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  }
  return { start }
}
