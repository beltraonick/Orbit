export interface ExportEntry {
  full_name: string
  date: string
  hours: number
  daily_rate: number
  hourly_rate: number
  project: string | null
}

export interface ExportExpense {
  employee_name: string
  description: string
  amount: number
  date: string
  category: string | null
  approval_status: string
}

export interface ExportMileage {
  employee_name: string
  date: string
  origin: string
  destination: string
  miles: number
  amount: number
  approval_status: string
}

export interface ExportData {
  company_name: string
  period_label: string
  period_start: string | null
  period_end: string | null
  entries: ExportEntry[]
  expenses: ExportExpense[]
  mileage: ExportMileage[]
}

function entryPay(e: ExportEntry): { isFullDay: boolean; total: number } {
  const isFullDay = e.hours >= 7
  const total = isFullDay
    ? e.daily_rate
    : Math.round((e.hours / 8) * e.daily_rate * 100) / 100
  return { isFullDay, total }
}

export async function exportPayrollXLSX(data: ExportData): Promise<void> {
  const XLSX = (await import('xlsx')).default
  const wb = XLSX.utils.book_new()

  // ── Tab 1: Daily Attendance ──────────────────────────────────────────────────
  const tab1Name = data.period_start && data.period_end
    ? `${data.period_start.slice(5)} to ${data.period_end.slice(5)}`
    : data.period_label.slice(0, 31)

  const attendanceRows = data.entries.map(e => {
    const { isFullDay, total } = entryPay(e)
    return {
      'EMPLOYEE NAME': e.full_name,
      'WORKED?': 'Yes',
      'DATE': e.date,
      'PRICE $': e.daily_rate,
      'FULL DAY?': isFullDay ? 'Yes' : 'No',
      'TOTAL $': total,
      'NOTES': e.project ?? '',
    }
  })

  const ws1 = XLSX.utils.json_to_sheet(attendanceRows.length ? attendanceRows : [
    { 'EMPLOYEE NAME': '', 'WORKED?': '', 'DATE': '', 'PRICE $': '', 'FULL DAY?': '', 'TOTAL $': '', 'NOTES': '' },
  ])
  XLSX.utils.book_append_sheet(wb, ws1, tab1Name.slice(0, 31))

  // ── Tab 2: Payroll Summary ───────────────────────────────────────────────────
  const empPayMap = new Map<string, number>()
  for (const e of data.entries) {
    const { total } = entryPay(e)
    empPayMap.set(e.full_name, (empPayMap.get(e.full_name) ?? 0) + total)
  }

  const payDate = data.period_end
    ? new Date(data.period_end + 'T12:00:00').toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
      })
    : new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })

  const grandPayroll = Array.from(empPayMap.values()).reduce((s, v) => s + v, 0)
  const payrollRows = [
    ...Array.from(empPayMap.entries()).map(([name, total]) => ({
      'EMPLOYEE NAME': name,
      'TOTAL $': total,
    })),
    { 'EMPLOYEE NAME': 'TOTAL', 'TOTAL $': grandPayroll },
  ]
  const ws2 = XLSX.utils.json_to_sheet(payrollRows.length ? payrollRows : [
    { 'EMPLOYEE NAME': '', 'TOTAL $': '' },
  ])
  XLSX.utils.book_append_sheet(wb, ws2, `Payroll - ${payDate}`)

  // ── Tab 3: Financial Summary ─────────────────────────────────────────────────
  const totalReimb = data.expenses
    .filter(e => e.approval_status === 'approved')
    .reduce((s, e) => s + e.amount, 0)
  const totalMileage = data.mileage
    .filter(m => m.approval_status === 'approved')
    .reduce((s, m) => s + m.amount, 0)

  const financialRows = [
    { CATEGORY: 'Payroll', AMOUNT: grandPayroll },
    { CATEGORY: 'Reimbursements', AMOUNT: totalReimb },
    { CATEGORY: 'Mileage', AMOUNT: totalMileage },
    { CATEGORY: '', AMOUNT: '' },
    { CATEGORY: 'GRAND TOTAL', AMOUNT: grandPayroll + totalReimb + totalMileage },
  ]
  const ws3 = XLSX.utils.json_to_sheet(financialRows)
  XLSX.utils.book_append_sheet(wb, ws3, '$')

  // ── Tab 4: Overtime ──────────────────────────────────────────────────────────
  const overtimeRows = data.entries
    .filter(e => e.hours > 8)
    .map(e => {
      const otHours = Math.round((e.hours - 8) * 100) / 100
      const pricePerHr =
        e.daily_rate > 0
          ? Math.round((e.daily_rate / 8) * 100) / 100
          : e.hourly_rate
      const otTotal = Math.round(otHours * pricePerHr * 1.5 * 100) / 100
      return {
        'EMPLOYEE NAME': e.full_name,
        'DATE': e.date,
        'PRICE $': e.daily_rate,
        'PRICE PER HR': pricePerHr,
        'OVERTIME (HR)': otHours,
        'OVERTIME TOTAL $': otTotal,
        'JOB': e.project ?? '',
      }
    })

  const otPivotMap = new Map<string, number>()
  for (const row of overtimeRows) {
    otPivotMap.set(
      row['EMPLOYEE NAME'],
      (otPivotMap.get(row['EMPLOYEE NAME']) ?? 0) + row['OVERTIME TOTAL $'],
    )
  }

  const ws4Data = overtimeRows.length
    ? [
        ...overtimeRows,
        { 'EMPLOYEE NAME': '', 'DATE': '', 'PRICE $': '', 'PRICE PER HR': '', 'OVERTIME (HR)': '', 'OVERTIME TOTAL $': '', 'JOB': '' },
        ...Array.from(otPivotMap.entries()).map(([name, total]) => ({
          'EMPLOYEE NAME': name,
          'DATE': 'OVERTIME TOTAL',
          'PRICE $': '',
          'PRICE PER HR': '',
          'OVERTIME (HR)': '',
          'OVERTIME TOTAL $': total,
          'JOB': '',
        })),
      ]
    : [{ 'EMPLOYEE NAME': 'No overtime entries', 'DATE': '', 'PRICE $': '', 'PRICE PER HR': '', 'OVERTIME (HR)': '', 'OVERTIME TOTAL $': '', 'JOB': '' }]

  const ws4 = XLSX.utils.json_to_sheet(ws4Data)
  XLSX.utils.book_append_sheet(wb, ws4, 'Overtime')

  XLSX.writeFile(wb, `Payroll-${data.period_start ?? new Date().toISOString().slice(0, 10)}.xlsx`)
}
