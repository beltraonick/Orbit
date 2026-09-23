import { calcEntryPay } from '@/lib/payroll-calc'

export interface ExportEntry {
  full_name: string
  date: string
  hours: number | null
  daily_rate: number
  hourly_rate: number
  is_full_day: boolean | null
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

// Delegates to the same calcEntryPay() the Admin Payroll page uses, so this
// export can never disagree with what the app shows on screen.
function entryPay(e: ExportEntry) {
  return calcEntryPay({
    clock_in: e.date,
    clock_out: null,
    hours_worked: e.hours,
    is_full_day: e.is_full_day,
    daily_rate: e.daily_rate,
    hourly_rate: e.hourly_rate,
  })
}

export async function exportPayrollXLSX(data: ExportData): Promise<void> {
  const XLSX = (await import('xlsx')).default
  const wb = XLSX.utils.book_new()

  // ── Tab 1: Daily Attendance ──────────────────────────────────────────────────
  const tab1Name = data.period_start && data.period_end
    ? `${data.period_start.slice(5)} to ${data.period_end.slice(5)}`
    : data.period_label.slice(0, 31)

  const attendanceRows = data.entries.map(e => {
    const calc = entryPay(e)
    return {
      'EMPLOYEE NAME': e.full_name,
      'WORKED?': 'Yes',
      'DATE': e.date,
      'PAY TYPE': calc.payMode === 'daily' ? 'Daily' : 'Hourly',
      'PRICE $': calc.payMode === 'daily' ? calc.dailyRate : calc.hourlyRate,
      'FULL DAY?': calc.payMode === 'daily' ? (calc.fullDay ? 'Yes' : 'No') : '—',
      'HOURS': e.hours != null ? Math.round(e.hours * 100) / 100 : '',
      'TOTAL $': Math.round(calc.totalPay * 100) / 100,
      'NOTES': e.project ?? '',
    }
  })

  const ws1 = XLSX.utils.json_to_sheet(attendanceRows.length ? attendanceRows : [
    { 'EMPLOYEE NAME': '', 'WORKED?': '', 'DATE': '', 'PAY TYPE': '', 'PRICE $': '', 'FULL DAY?': '', 'HOURS': '', 'TOTAL $': '', 'NOTES': '' },
  ])
  XLSX.utils.book_append_sheet(wb, ws1, tab1Name.slice(0, 31))

  // ── Tab 2: Payroll Summary ───────────────────────────────────────────────────
  const empPayMap = new Map<string, number>()
  for (const e of data.entries) {
    const calc = entryPay(e)
    empPayMap.set(e.full_name, (empPayMap.get(e.full_name) ?? 0) + calc.totalPay)
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
  // Overtime only applies to daily-rate people (hours beyond a standard 8h
  // day), same rule as the Admin Payroll page — calcEntryPay() is what
  // decides this, not a separate check here.
  const overtimeRows = data.entries
    .map(e => ({ e, calc: entryPay(e) }))
    .filter(({ calc }) => calc.overtimeHours > 0)
    .map(({ e, calc }) => ({
      'EMPLOYEE NAME': e.full_name,
      'DATE': e.date,
      'PRICE $': calc.dailyRate,
      'PRICE PER HR': Math.round((calc.dailyRate / 8) * 100) / 100,
      'OVERTIME (HR)': Math.round(calc.overtimeHours * 100) / 100,
      'OVERTIME TOTAL $': Math.round(calc.overtimePay * 100) / 100,
      'JOB': e.project ?? '',
    }))

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

  // ── Tab 5: Expenses (itemized) ───────────────────────────────────────────────
  const expenseRows = data.expenses.map(x => ({
    'EMPLOYEE NAME': x.employee_name,
    'DESCRIPTION': x.description,
    'CATEGORY': x.category ?? '',
    'DATE': x.date,
    'STATUS': x.approval_status,
    'AMOUNT $': x.amount,
  }))
  const ws5 = XLSX.utils.json_to_sheet(expenseRows.length ? expenseRows : [
    { 'EMPLOYEE NAME': 'No expenses for this period', 'DESCRIPTION': '', 'CATEGORY': '', 'DATE': '', 'STATUS': '', 'AMOUNT $': '' },
  ])
  XLSX.utils.book_append_sheet(wb, ws5, 'Expenses')

  // ── Tab 6: Mileage (itemized) ────────────────────────────────────────────────
  const mileageRows = data.mileage.map(m => ({
    'EMPLOYEE NAME': m.employee_name,
    'DATE': m.date,
    'ORIGIN': m.origin,
    'DESTINATION': m.destination,
    'MILES': m.miles,
    'STATUS': m.approval_status,
    'AMOUNT $': m.amount,
  }))
  const ws6 = XLSX.utils.json_to_sheet(mileageRows.length ? mileageRows : [
    { 'EMPLOYEE NAME': 'No mileage trips for this period', 'DATE': '', 'ORIGIN': '', 'DESTINATION': '', 'MILES': '', 'STATUS': '', 'AMOUNT $': '' },
  ])
  XLSX.utils.book_append_sheet(wb, ws6, 'Mileage')

  XLSX.writeFile(wb, `Payroll-${data.period_start ?? new Date().toISOString().slice(0, 10)}.xlsx`)
}
