'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { Card } from '@/components/ui/Card'
import { useTranslation } from '@/lib/i18n/LocaleContext'

const STANDARD_DAY_HOURS = 8

const fmt$ = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const fmtDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'numeric', day: 'numeric', year: '2-digit',
  })

function downloadCSV(filename: string, csvContent: string) {
  const BOM = '﻿'
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function escapeCSV(v: string | number | null | undefined): string {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

interface DayRow {
  entryId: string
  personId: string
  personName: string
  date: string        // YYYY-MM-DD
  projectName: string
  dailyRate: number
  hoursWorked: number | null
  isFullDay: boolean | null
  notes: string | null
  // computed
  fullDay: boolean
  totalPay: number
  overtimeHours: number
  overtimePay: number
}

interface Summary {
  personId: string
  personName: string
  totalDays: number
  fullDays: number
  partialDays: number
  totalPay: number
  overtimePay: number
}

function getQuinzenaDates(which: 'current' | 'last'): { start: string; end: string } {
  const now = new Date()
  const day = now.getDate()
  const year = now.getFullYear()
  const month = now.getMonth()

  let start: Date, end: Date
  if (which === 'current') {
    if (day <= 14) {
      start = new Date(year, month, 1)
      end = new Date(year, month, 14)
    } else {
      start = new Date(year, month, 15)
      end = new Date(year, month + 1, 0)
    }
  } else {
    if (day <= 14) {
      start = new Date(year, month - 1, 15)
      end = new Date(year, month, 0)
    } else {
      start = new Date(year, month, 1)
      end = new Date(year, month, 14)
    }
  }
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

function toISO(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toISOString()
}
function toISOEnd(dateStr: string) {
  return new Date(dateStr + 'T23:59:59').toISOString()
}

export function PayrollManager() {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const printRef = useRef<HTMLDivElement>(null)

  const [tab, setTab] = useState<'detail' | 'summary' | 'overtime'>('detail')
  const [preset, setPreset] = useState<'current' | 'last' | 'custom'>('last')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [rows, setRows] = useState<DayRow[]>([])
  const [loading, setLoading] = useState(true)

  const periodStart = preset === 'custom' ? customStart : getQuinzenaDates(preset as 'current' | 'last').start
  const periodEnd   = preset === 'custom' ? customEnd   : getQuinzenaDates(preset as 'current' | 'last').end

  const load = useCallback(async () => {
    if (!periodStart || !periodEnd) return
    setLoading(true)
    const supabase = createClient()

    const { data: entries } = await supabase
      .from('time_entries')
      .select(`
        id, clock_in, clock_out, hours_worked, is_full_day, notes, employee_id, worker_id,
        project:project_id(name),
        profile:employee_id(full_name, daily_rate, hourly_rate),
        worker:worker_id(full_name, daily_rate)
      `)
      .eq('company_id', companyId)
      .not('clock_out', 'is', null)
      .gte('clock_in', toISO(periodStart))
      .lte('clock_in', toISOEnd(periodEnd))
      .order('clock_in', { ascending: true })

    const built: DayRow[] = (entries ?? []).map((e: Record<string, unknown>) => {
      type Profile = { full_name: string; daily_rate: number | null; hourly_rate: number }
      type Worker  = { full_name: string; daily_rate: number }
      type Project = { name: string }

      const profile = e.profile as Profile | null
      const worker  = e.worker  as Worker | null
      const project = e.project as Project | null

      const personId   = (e.employee_id as string | null) ?? (e.worker_id as string)
      const personName = profile?.full_name ?? worker?.full_name ?? 'Unknown'
      const rawRate    = profile
        ? (profile.daily_rate ?? (profile.hourly_rate * STANDARD_DAY_HOURS))
        : (worker?.daily_rate ?? 0)
      const dailyRate = Number(rawRate) || 0

      const hours      = e.hours_worked != null ? Number(e.hours_worked) : null
      const isFullDay  = e.is_full_day as boolean | null
      const date       = (e.clock_in as string).slice(0, 10)

      // Determine if it's a full day
      const fullDay = isFullDay === true || (isFullDay === null && (hours == null || hours >= STANDARD_DAY_HOURS))

      // Calculate total pay
      let totalPay: number
      if (fullDay) {
        totalPay = dailyRate
      } else if (hours != null && hours > 0) {
        totalPay = (hours / STANDARD_DAY_HOURS) * dailyRate
      } else {
        totalPay = dailyRate
      }

      // Overtime: hours beyond standard day
      const overtimeHours = (hours != null && hours > STANDARD_DAY_HOURS) ? hours - STANDARD_DAY_HOURS : 0
      const hourlyEquiv   = dailyRate / STANDARD_DAY_HOURS
      const overtimePay   = overtimeHours * hourlyEquiv * 1.5

      return {
        entryId: e.id as string,
        personId,
        personName,
        date,
        projectName: project?.name ?? '—',
        dailyRate,
        hoursWorked: hours,
        isFullDay,
        notes: e.notes as string | null,
        fullDay,
        totalPay,
        overtimeHours,
        overtimePay,
      }
    })

    setRows(built)
    setLoading(false)
  }, [companyId, periodStart, periodEnd])

  useEffect(() => { load() }, [load])

  // Summary by person
  const summaries: Summary[] = Object.values(
    rows.reduce((acc, row) => {
      if (!acc[row.personId]) {
        acc[row.personId] = {
          personId: row.personId,
          personName: row.personName,
          totalDays: 0,
          fullDays: 0,
          partialDays: 0,
          totalPay: 0,
          overtimePay: 0,
        }
      }
      acc[row.personId].totalDays   += 1
      acc[row.personId].fullDays    += row.fullDay ? 1 : 0
      acc[row.personId].partialDays += row.fullDay ? 0 : 1
      acc[row.personId].totalPay    += row.totalPay
      acc[row.personId].overtimePay += row.overtimePay
      return acc
    }, {} as Record<string, Summary>)
  ).sort((a, b) => a.personName.localeCompare(b.personName))

  const overtimeRows = rows.filter(r => r.overtimeHours > 0)

  const grandTotal   = summaries.reduce((s, r) => s + r.totalPay, 0)
  const overtimeTotal = summaries.reduce((s, r) => s + r.overtimePay, 0)

  function exportDetailCSV() {
    const header = ['EMPLOYEE NAME', 'WORKED?', 'DATE', 'PRICE $', 'FULL DAY?', 'TOTAL $', 'NOTES', 'JOB NAME']
    const dataRows = rows.map(r => [
      r.personName,
      'Yes',
      fmtDate(r.date),
      r.dailyRate.toFixed(2),
      r.fullDay ? 'Yes' : 'No',
      r.totalPay.toFixed(2),
      r.notes ?? '',
      r.projectName,
    ])
    const csv = [header, ...dataRows].map(row => row.map(escapeCSV).join(',')).join('\n')
    const label = periodStart && periodEnd ? `${periodStart}_to_${periodEnd}` : 'payroll'
    downloadCSV(`Payroll_Detail_${label}.csv`, csv)
  }

  function printInvoice() {
    const periodLabel = periodStart && periodEnd ? `${fmtDate(periodStart)} to ${fmtDate(periodEnd)}` : ''

    const perPerson = summaries.map(s => {
      const personRows = rows.filter(r => r.personId === s.personId)
      const hasOvertime = s.overtimePay > 0

      const payrollRows = personRows.map(r =>
        `<tr>
          <td class="tag payroll">PAYROLL</td>
          <td class="desc">Payroll - ${fmtDate(r.date)} · ${r.projectName}${r.notes ? ' · ' + r.notes : ''}</td>
          <td class="amount">${fmt$(r.totalPay)}</td>
        </tr>`
      ).join('')

      const overtimeRow = hasOvertime
        ? `<tr>
            <td class="tag overtime">OVERTIME</td>
            <td class="desc">Overtime - ${periodLabel}</td>
            <td class="amount">${fmt$(s.overtimePay)}</td>
          </tr>`
        : ''

      return `
        <div class="section">
          <h2 class="name">${s.personName}</h2>
          <table>
            <thead>
              <tr class="th-row">
                <th>TYPE</th><th>DESCRIPTION</th><th>AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              ${payrollRows}
              ${overtimeRow}
            </tbody>
            <tfoot>
              <tr class="subtotal">
                <td colspan="2">SUBTOTAL</td>
                <td class="amount">${fmt$(s.totalPay + s.overtimePay)}</td>
              </tr>
            </tfoot>
          </table>
        </div>`
    }).join('')

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Payroll Invoice – ${periodLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #222; padding: 24px; }
  .header { text-align: center; margin-bottom: 24px; }
  .header h1 { font-size: 22px; font-weight: bold; letter-spacing: 1px; margin-bottom: 4px; }
  .header .period { font-size: 13px; color: #555; }
  .meta { display: flex; justify-content: flex-end; margin-bottom: 20px; }
  .meta table td { padding: 2px 8px; font-size: 11px; }
  .meta table td:first-child { font-weight: bold; background: #1a1a5e; color: white; }
  .totals-bar { display: flex; gap: 16px; margin-bottom: 24px; }
  .total-box { flex: 1; border: 1px solid #ccc; padding: 8px 12px; }
  .total-box .label { font-size: 10px; font-weight: bold; color: #1a1a5e; margin-bottom: 2px; }
  .total-box .value { font-size: 16px; font-weight: bold; }
  .section { margin-bottom: 20px; page-break-inside: avoid; }
  .section .name { background: #1a1a5e; color: white; padding: 6px 10px; font-size: 13px; font-weight: bold; }
  .section table { width: 100%; border-collapse: collapse; }
  .th-row th { background: #1a1a5e; color: white; text-align: left; padding: 5px 8px; font-size: 10px; text-transform: uppercase; }
  .th-row th:last-child { text-align: right; }
  .section table td { padding: 5px 8px; border-bottom: 1px solid #eee; }
  .section table td.amount { text-align: right; font-weight: 600; }
  .tag { font-size: 10px; font-weight: bold; text-transform: uppercase; white-space: nowrap; padding: 2px 6px !important; }
  .tag.payroll { background: #d32f2f; color: white; }
  .tag.overtime { background: #1a1a5e; color: white; }
  .subtotal td { font-weight: bold; background: #f5f5f5; }
  .subtotal td:first-child { text-align: right; font-size: 11px; text-transform: uppercase; }
  .grand-total { margin-top: 16px; text-align: right; font-size: 16px; font-weight: bold; border-top: 3px solid #d32f2f; padding-top: 8px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<div class="header">
  <h1>PAYMENT RECEIPT</h1>
  <div class="period">PAY PERIOD: ${periodLabel}</div>
</div>
<div class="totals-bar">
  <div class="total-box">
    <div class="label">PAYROLL TOTAL</div>
    <div class="value">${fmt$(grandTotal)}</div>
  </div>
  <div class="total-box">
    <div class="label">OVERTIME TOTAL</div>
    <div class="value">${fmt$(overtimeTotal)}</div>
  </div>
  <div class="total-box">
    <div class="label">INVOICE TOTAL</div>
    <div class="value">${fmt$(grandTotal + overtimeTotal)}</div>
  </div>
</div>
${perPerson}
<div class="grand-total">TOTAL: ${fmt$(grandTotal + overtimeTotal)}</div>
</body>
</html>`

    const win = window.open('', '_blank')
    if (win) {
      win.document.write(html)
      win.document.close()
      win.focus()
      setTimeout(() => win.print(), 500)
    }
  }

  const PRESET_OPTIONS = [
    { value: 'last',    label: t('admin.payroll.lastQuinzena') },
    { value: 'current', label: t('admin.payroll.currentQuinzena') },
    { value: 'custom',  label: t('admin.payroll.customPeriod') },
  ]

  return (
    <div className="p-4 md:p-6 max-w-[1400px]" ref={printRef}>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-primary tracking-tight">{t('admin.payroll.title')}</h1>
          <p className="text-sm text-secondary mt-1">
            {periodStart && periodEnd ? `${fmtDate(periodStart)} – ${fmtDate(periodEnd)}` : ''}
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          {rows.length > 0 && (
            <>
              <button
                onClick={exportDetailCSV}
                className="flex items-center gap-1.5 px-3 py-2 rounded-button border border-[var(--border)] text-sm text-secondary hover:text-primary transition-colors"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                {t('admin.payroll.exportCSV')}
              </button>
              <button
                onClick={printInvoice}
                className="flex items-center gap-1.5 px-3 py-2 rounded-button bg-red-700 text-white text-sm hover:bg-red-800 transition-colors"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9h8v4H6v-4zm-2-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
                </svg>
                {t('admin.payroll.exportInvoice')}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Period controls */}
      <div className="flex flex-wrap gap-3 mb-6 print:hidden">
        <div className="flex rounded-button border border-[var(--border)] overflow-hidden">
          {PRESET_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setPreset(opt.value as typeof preset)}
              className={`px-3 py-2 text-sm transition-colors ${
                preset === opt.value
                  ? 'bg-[var(--color-brand)] text-white'
                  : 'text-secondary hover:text-primary bg-surface'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={e => setCustomStart(e.target.value)}
              className="text-sm rounded-button border border-[var(--border)] px-2.5 py-2 bg-surface text-primary"
            />
            <span className="text-secondary text-sm">→</span>
            <input
              type="date"
              value={customEnd}
              onChange={e => setCustomEnd(e.target.value)}
              className="text-sm rounded-button border border-[var(--border)] px-2.5 py-2 bg-surface text-primary"
            />
          </div>
        )}
      </div>

      {/* Totals bar */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card>
            <p className="text-xs text-secondary mb-1">{t('admin.payroll.totalWorkers')}</p>
            <p className="text-2xl font-bold text-primary">{summaries.length}</p>
          </Card>
          <Card>
            <p className="text-xs text-secondary mb-1">{t('admin.payroll.totalDays')}</p>
            <p className="text-2xl font-bold text-primary">{rows.length}</p>
          </Card>
          <Card>
            <p className="text-xs text-secondary mb-1">{t('admin.payroll.payrollTotal')}</p>
            <p className="text-2xl font-bold text-primary">{fmt$(grandTotal)}</p>
          </Card>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] mb-4 print:hidden">
        {(['detail', 'summary', 'overtime'] as const).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === tabKey
                ? 'border-[var(--color-brand)] text-primary'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {t(`admin.payroll.tab_${tabKey}`)}
            {tabKey === 'overtime' && overtimeRows.length > 0 && (
              <span className="ml-1.5 bg-amber/10 text-amber text-xs px-1.5 py-0.5 rounded-full">
                {overtimeRows.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && (
        <p className="text-sm text-secondary text-center py-12">{t('common.loading')}</p>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-[var(--border)] rounded-card">
          <p className="text-sm font-medium text-secondary">{t('admin.payroll.noData')}</p>
        </div>
      )}

      {/* ─── Detail tab ─── */}
      {!loading && rows.length > 0 && tab === 'detail' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-red-700 text-white">
                <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                  {t('admin.payroll.col_employee')}
                </th>
                <th className="text-center px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                  {t('admin.payroll.col_worked')}
                </th>
                <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                  {t('admin.payroll.col_date')}
                </th>
                <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                  {t('admin.payroll.col_price')}
                </th>
                <th className="text-center px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                  {t('admin.payroll.col_fullDay')}
                </th>
                <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                  {t('admin.payroll.col_total')}
                </th>
                <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide">
                  {t('admin.payroll.col_notes')}
                </th>
                <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                  {t('admin.payroll.col_job')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.entryId}
                  className={i % 2 === 0 ? 'bg-surface' : 'bg-[var(--color-surface-elevated)]'}
                >
                  <td className="px-3 py-2 font-medium text-primary whitespace-nowrap">{row.personName}</td>
                  <td className="px-3 py-2 text-center text-secondary">Yes</td>
                  <td className="px-3 py-2 text-secondary whitespace-nowrap">{fmtDate(row.date)}</td>
                  <td className="px-3 py-2 text-right text-secondary tabular-nums">{fmt$(row.dailyRate)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      row.fullDay
                        ? 'bg-green/10 text-green'
                        : 'bg-amber/10 text-amber'
                    }`}>
                      {row.fullDay ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold text-primary tabular-nums">
                    {fmt$(row.totalPay)}
                  </td>
                  <td className="px-3 py-2 text-secondary max-w-[200px] truncate">{row.notes ?? ''}</td>
                  <td className="px-3 py-2 text-secondary whitespace-nowrap">{row.projectName}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-red-800 text-white">
                <td className="px-3 py-2 font-bold text-xs uppercase" colSpan={5}>
                  {t('admin.payroll.grandTotal')}
                </td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">{fmt$(grandTotal)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ─── Summary tab ─── */}
      {!loading && rows.length > 0 && tab === 'summary' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-red-700 text-white">
                <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide">
                  {t('admin.payroll.col_employee')}
                </th>
                <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                  {t('admin.payroll.col_totalDays')}
                </th>
                <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                  {t('admin.payroll.col_fullDays')}
                </th>
                <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                  {t('admin.payroll.col_partialDays')}
                </th>
                <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                  {t('admin.payroll.col_total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s, i) => (
                <tr key={s.personId} className={i % 2 === 0 ? 'bg-surface' : 'bg-[var(--color-surface-elevated)]'}>
                  <td className="px-3 py-2.5 font-medium text-primary">{s.personName}</td>
                  <td className="px-3 py-2.5 text-right text-secondary tabular-nums">{s.totalDays}</td>
                  <td className="px-3 py-2.5 text-right text-secondary tabular-nums">{s.fullDays}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {s.partialDays > 0 ? (
                      <span className="text-amber font-medium">{s.partialDays}</span>
                    ) : (
                      <span className="text-tertiary">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-primary tabular-nums">
                    {fmt$(s.totalPay)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-red-800 text-white">
                <td className="px-3 py-2 font-bold text-xs uppercase">
                  {t('admin.payroll.grandTotal')}
                </td>
                <td className="px-3 py-2 text-right font-bold tabular-nums">
                  {rows.length}
                </td>
                <td colSpan={2} />
                <td className="px-3 py-2 text-right font-bold tabular-nums">
                  {fmt$(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ─── Overtime tab ─── */}
      {!loading && tab === 'overtime' && (
        overtimeRows.length === 0 ? (
          <div className="text-center py-12 text-sm text-secondary">
            {t('admin.payroll.noOvertime')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-red-700 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('admin.payroll.col_employee')}
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('admin.payroll.col_date')}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('admin.payroll.col_price')}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('admin.payroll.col_pricePerHr')}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('admin.payroll.col_overtimeHrs')}
                  </th>
                  <th className="text-right px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('admin.payroll.col_overtimeTotal')}
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
                    {t('admin.payroll.col_job')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {overtimeRows.map((row, i) => (
                  <tr key={row.entryId} className={i % 2 === 0 ? 'bg-surface' : 'bg-[var(--color-surface-elevated)]'}>
                    <td className="px-3 py-2 font-medium text-primary whitespace-nowrap">{row.personName}</td>
                    <td className="px-3 py-2 text-secondary whitespace-nowrap">{fmtDate(row.date)}</td>
                    <td className="px-3 py-2 text-right text-secondary tabular-nums">{fmt$(row.dailyRate)}</td>
                    <td className="px-3 py-2 text-right text-secondary tabular-nums">
                      {fmt$(row.dailyRate / STANDARD_DAY_HOURS)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-amber tabular-nums">
                      {row.overtimeHours.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-primary tabular-nums">
                      {fmt$(row.overtimePay)}
                    </td>
                    <td className="px-3 py-2 text-secondary whitespace-nowrap">{row.projectName}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-red-800 text-white">
                  <td colSpan={4} className="px-3 py-2 font-bold text-xs uppercase">
                    {t('admin.payroll.grandTotal')}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {overtimeRows.reduce((s, r) => s + r.overtimeHours, 0).toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {fmt$(overtimeTotal)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </div>
  )
}
