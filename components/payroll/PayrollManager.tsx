'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { calcEntryPay, STANDARD_DAY_HOURS } from '@/lib/payroll-calc'
import { finalizePayrollPeriod, getFinalizedPayrollPeriod } from '@/app/actions/payrollActions'

const fmt$ = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const fmtDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'numeric', day: 'numeric', year: '2-digit',
  })

const fmtDateLong = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
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
  date: string
  projectName: string
  payMode: 'daily' | 'hourly'
  dailyRate: number
  hourlyRate: number
  hoursWorked: number | null
  isFullDay: boolean | null
  notes: string | null
  fullDay: boolean
  totalPay: number
  overtimeHours: number
  overtimePay: number
}

interface Summary {
  personId: string
  personName: string
  payMode: 'daily' | 'hourly'
  totalDays: number
  fullDays: number
  partialDays: number
  totalHours: number
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
    if (day <= 15) {
      start = new Date(year, month, 1)
      end = new Date(year, month, 15)
    } else {
      start = new Date(year, month, 16)
      end = new Date(year, month + 1, 0)
    }
  } else {
    if (day <= 15) {
      start = new Date(year, month - 1, 16)
      end = new Date(year, month, 0)
    } else {
      start = new Date(year, month, 1)
      end = new Date(year, month, 15)
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

  // Finalized-period lock. Once a period is finalized, its numbers are read
  // from the permanent snapshot instead of recomputed live, so later rate or
  // Pay System changes can never move a paid period's numbers.
  const [finalized, setFinalized] = useState(false)
  const [finalizedAt, setFinalizedAt] = useState<string | null>(null)
  const [finalizedByName, setFinalizedByName] = useState<string | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState('')

  const periodStart = preset === 'custom' ? customStart : getQuinzenaDates(preset as 'current' | 'last').start
  const periodEnd   = preset === 'custom' ? customEnd   : getQuinzenaDates(preset as 'current' | 'last').end

  const load = useCallback(async () => {
    if (!periodStart || !periodEnd) return
    setLoading(true)
    setFinalizeError('')

    const snapshot = await getFinalizedPayrollPeriod(periodStart, periodEnd)
    if (snapshot.finalized) {
      setFinalized(true)
      setFinalizedAt(snapshot.finalizedAt)
      setFinalizedByName(snapshot.finalizedByName)
      setRows(snapshot.entries.map((e): DayRow => ({
        entryId: e.id,
        personId: e.person_id,
        personName: e.person_name,
        date: e.entry_date,
        projectName: e.project_name ?? '—',
        payMode: e.pay_mode,
        dailyRate: Number(e.daily_rate),
        hourlyRate: Number(e.hourly_rate),
        hoursWorked: e.hours_worked != null ? Number(e.hours_worked) : null,
        isFullDay: e.is_full_day,
        notes: e.notes,
        fullDay: e.full_day,
        totalPay: Number(e.total_pay),
        overtimeHours: Number(e.overtime_hours),
        overtimePay: Number(e.overtime_pay),
      })))
      setLoading(false)
      return
    }
    setFinalized(false)
    setFinalizedAt(null)
    setFinalizedByName(null)

    const supabase = createClient()

    const { data: entries } = await supabase
      .from('time_entries')
      .select(`
        id, clock_in, clock_out, hours_worked, is_full_day, notes, employee_id, worker_id,
        project:project_id(name),
        profile:employee_id(full_name, daily_rate, hourly_rate),
        worker:worker_id(full_name, daily_rate, hourly_rate)
      `)
      .eq('company_id', companyId)
      .not('clock_out', 'is', null)
      .gte('clock_in', toISO(periodStart))
      .lte('clock_in', toISOEnd(periodEnd))
      .order('clock_in', { ascending: true })

    const built: DayRow[] = (entries ?? []).map((e: Record<string, unknown>) => {
      type Profile = { full_name: string; daily_rate: number | null; hourly_rate: number }
      type Worker  = { full_name: string; daily_rate: number | null; hourly_rate: number | null }
      type Project = { name: string }

      const profile = e.profile as Profile | null
      const worker  = e.worker  as Worker | null
      const project = e.project as Project | null

      const personId   = (e.employee_id as string | null) ?? (e.worker_id as string)
      const personName = profile?.full_name ?? worker?.full_name ?? 'Unknown'
      const date       = (e.clock_in as string).slice(0, 10)

      const calc = calcEntryPay({
        clock_in: e.clock_in as string,
        clock_out: e.clock_out as string | null,
        hours_worked: e.hours_worked != null ? Number(e.hours_worked) : null,
        is_full_day: e.is_full_day as boolean | null,
        daily_rate: profile?.daily_rate ?? worker?.daily_rate ?? null,
        hourly_rate: profile?.hourly_rate ?? worker?.hourly_rate ?? null,
      })

      return {
        entryId: e.id as string,
        personId,
        personName,
        date,
        projectName: project?.name ?? '—',
        payMode: calc.payMode,
        dailyRate: calc.dailyRate,
        hourlyRate: calc.hourlyRate,
        hoursWorked: calc.hoursWorked,
        isFullDay: e.is_full_day as boolean | null,
        notes: e.notes as string | null,
        fullDay: calc.fullDay,
        totalPay: calc.totalPay,
        overtimeHours: calc.overtimeHours,
        overtimePay: calc.overtimePay,
      }
    })

    setRows(built)
    setLoading(false)
  }, [companyId, periodStart, periodEnd])

  useEffect(() => { load() }, [load])

  async function handleFinalize() {
    if (!periodStart || !periodEnd) return
    const label = `${fmtDateLong(periodStart)} – ${fmtDateLong(periodEnd)}`
    const confirmed = window.confirm(
      `Finalize payroll for ${label}?\n\nThis locks in today's numbers for this period FOREVER. Later changes to anyone's rate, or to the company's Pay System, will never affect this period again. This cannot be undone.\n\nOnly do this once you've actually paid this period.`
    )
    if (!confirmed) return

    setFinalizing(true)
    setFinalizeError('')
    const result = await finalizePayrollPeriod(periodStart, periodEnd)
    setFinalizing(false)
    if (result.error) {
      setFinalizeError(result.error)
      return
    }
    await load()
  }

  const summaries: Summary[] = Object.values(
    rows.reduce((acc, row) => {
      if (!acc[row.personId]) {
        acc[row.personId] = {
          personId: row.personId,
          personName: row.personName,
          payMode: row.payMode,
          totalDays: 0,
          fullDays: 0,
          partialDays: 0,
          totalHours: 0,
          totalPay: 0,
          overtimePay: 0,
        }
      }
      acc[row.personId].totalDays   += 1
      acc[row.personId].fullDays    += row.fullDay ? 1 : 0
      acc[row.personId].partialDays += row.fullDay ? 0 : 1
      acc[row.personId].totalHours  += row.hoursWorked ?? 0
      acc[row.personId].totalPay    += row.totalPay
      acc[row.personId].overtimePay += row.overtimePay
      return acc
    }, {} as Record<string, Summary>)
  ).sort((a, b) => a.personName.localeCompare(b.personName))

  const overtimeRows = rows.filter(r => r.overtimeHours > 0)
  const grandTotal    = summaries.reduce((s, r) => s + r.totalPay, 0)
  const overtimeTotal = summaries.reduce((s, r) => s + r.overtimePay, 0)

  function exportDetailCSV() {
    const header = ['EMPLOYEE NAME', 'PAY TYPE', 'WORKED?', 'DATE', 'PRICE $', 'FULL DAY?', 'HOURS', 'TOTAL $', 'NOTES', 'JOB NAME']
    const dataRows = rows.map(r => [
      r.personName,
      r.payMode === 'daily' ? 'Daily' : 'Hourly',
      'Yes',
      fmtDate(r.date),
      r.payMode === 'daily' ? r.dailyRate.toFixed(2) : r.hourlyRate.toFixed(2),
      r.payMode === 'daily' ? (r.fullDay ? 'Yes' : 'No') : '—',
      r.hoursWorked != null ? r.hoursWorked.toFixed(1) : '—',
      r.totalPay.toFixed(2),
      r.notes ?? '',
      r.projectName,
    ])
    const csv = [header, ...dataRows].map(row => row.map(escapeCSV).join(',')).join('\n')
    const label = periodStart && periodEnd ? `${periodStart}_to_${periodEnd}` : 'payroll'
    downloadCSV(`Payroll_${label}.csv`, csv)
  }

  function printInvoice() {
    const periodLabel = periodStart && periodEnd ? `${fmtDateLong(periodStart)} to ${fmtDateLong(periodEnd)}` : ''

    const perPerson = summaries.map(s => {
      const personRows = rows.filter(r => r.personId === s.personId)
      const hasOvertime = s.overtimePay > 0

      const payrollRows = personRows.map(r =>
        `<tr>
          <td class="tag payroll">PAYROLL</td>
          <td class="desc">${fmtDate(r.date)} · ${r.projectName}${r.notes ? ' · ' + r.notes : ''}${
            r.payMode === 'daily'
              ? ` · ${r.fullDay ? 'Full day' : 'Half day'}`
              : r.hoursWorked ? ` · ${r.hoursWorked.toFixed(1)}h` : ''
          }</td>
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
          <h2 class="name">${s.personName} <span class="pay-type">${s.payMode === 'daily' ? 'Daily Rate' : 'Hourly Rate'}</span></h2>
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
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; color: #1c1c1e; padding: 32px; }
  .header { margin-bottom: 28px; border-bottom: 2px solid #1c1c1e; padding-bottom: 16px; }
  .header h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 4px; }
  .header .period { font-size: 13px; color: #6e6e73; }
  .totals-bar { display: flex; gap: 12px; margin-bottom: 28px; }
  .total-box { flex: 1; background: #f5f5f7; border-radius: 12px; padding: 14px 16px; }
  .total-box .label { font-size: 10px; font-weight: 600; color: #6e6e73; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .total-box .value { font-size: 20px; font-weight: 700; color: #1c1c1e; }
  .section { margin-bottom: 24px; page-break-inside: avoid; border-radius: 12px; overflow: hidden; border: 1px solid #d1d1d6; }
  .section .name { background: #1c1c1e; color: white; padding: 10px 14px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
  .pay-type { font-size: 10px; font-weight: 500; background: rgba(255,255,255,0.15); padding: 2px 8px; border-radius: 20px; }
  .section table { width: 100%; border-collapse: collapse; }
  .th-row th { background: #f5f5f7; color: #6e6e73; text-align: left; padding: 7px 12px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  .th-row th:last-child { text-align: right; }
  .section table td { padding: 8px 12px; border-bottom: 1px solid #f5f5f7; }
  .section table td.amount { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  .tag { font-size: 10px; font-weight: 600; text-transform: uppercase; white-space: nowrap; padding: 3px 8px !important; border-radius: 6px; }
  .tag.payroll { background: #e5f0ff; color: #0066cc; }
  .tag.overtime { background: #fff3e0; color: #e65100; }
  .subtotal td { font-weight: 700; background: #f5f5f7; }
  .subtotal td:first-child { text-align: right; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6e6e73; }
  .grand-total { margin-top: 20px; text-align: right; font-size: 18px; font-weight: 700; border-top: 2px solid #1c1c1e; padding-top: 12px; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
<div class="header">
  <h1>PAYROLL SUMMARY</h1>
  <div class="period">Pay Period: ${periodLabel}</div>
</div>
<div class="totals-bar">
  <div class="total-box">
    <div class="label">Total People</div>
    <div class="value">${summaries.length}</div>
  </div>
  <div class="total-box">
    <div class="label">Payroll Total</div>
    <div class="value">${fmt$(grandTotal)}</div>
  </div>
  <div class="total-box">
    <div class="label">Overtime Total</div>
    <div class="value">${fmt$(overtimeTotal)}</div>
  </div>
  <div class="total-box">
    <div class="label">Invoice Total</div>
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

  const TH = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-secondary whitespace-nowrap'
  const TH_R = TH + ' text-right'

  return (
    <div className="p-4 md:p-6 max-w-[1400px]" ref={printRef}>
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-primary tracking-tight">{t('admin.payroll.title')}</h1>
          {periodStart && periodEnd && (
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm text-secondary">
                {fmtDateLong(periodStart)} – {fmtDateLong(periodEnd)}
              </p>
              <button
                onClick={() => {
                  setCustomStart(periodStart)
                  setCustomEnd(periodEnd)
                  setPreset('custom')
                }}
                className="p-1 rounded text-tertiary hover:text-brand hover:bg-brand/10 transition-colors"
                aria-label="Edit date range"
                title="Edit date range"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
              </button>
            </div>
          )}
        </div>
        <div className="flex gap-2 print:hidden flex-wrap">
          {rows.length > 0 && (
            <>
              <button
                onClick={exportDetailCSV}
                className="flex items-center gap-1.5 px-3 py-2 rounded-button border border-[var(--border)] text-sm text-secondary hover:text-primary transition-colors bg-surface"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                {t('admin.payroll.exportCSV')}
              </button>
              <button
                onClick={printInvoice}
                className="flex items-center gap-1.5 px-3 py-2 rounded-button bg-brand text-white text-sm hover:opacity-90 transition-opacity"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0">
                  <path fillRule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a1 1 0 001 1h8a1 1 0 001-1v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a1 1 0 00-1-1H6a1 1 0 00-1 1zm2 0h6v3H7V4zm-1 9h8v4H6v-4zm-2-4a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
                </svg>
                {t('admin.payroll.exportInvoice')}
              </button>
              {!finalized && (
                <button
                  onClick={handleFinalize}
                  disabled={finalizing}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-button bg-primary text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 flex-shrink-0">
                    <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                  </svg>
                  {finalizing ? 'Finalizing…' : 'Finalize Payroll'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {finalizeError && (
        <div className="mb-4 px-4 py-2.5 rounded-button bg-danger/10 border border-danger/20 text-danger text-sm print:hidden">
          {finalizeError}
        </div>
      )}

      {finalized && (
        <div className="mb-6 px-4 py-3 rounded-button bg-green/10 border border-green/20 flex items-center gap-2.5 print:hidden">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green flex-shrink-0">
            <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
          </svg>
          <p className="text-sm text-green">
            Finalized{finalizedAt ? ` on ${new Date(finalizedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
            {finalizedByName ? ` by ${finalizedByName}` : ''} — these numbers are locked and will not change even if rates or the Pay System change later.
          </p>
        </div>
      )}

      {/* Period controls */}
      <div className="flex flex-wrap gap-3 mb-6 print:hidden">
        <div className="flex rounded-button border border-[var(--border)] overflow-hidden bg-surface">
          {PRESET_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setPreset(opt.value as typeof preset)}
              className={`px-3 py-2 text-sm transition-colors ${
                preset === opt.value
                  ? 'bg-brand text-white'
                  : 'text-secondary hover:text-primary'
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

      {/* Stats cards */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-surface border border-[var(--border)] rounded-card p-4">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1.5">{t('admin.payroll.totalWorkers')}</p>
            <p className="text-2xl font-bold text-primary">{summaries.length}</p>
          </div>
          <div className="bg-surface border border-[var(--border)] rounded-card p-4">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1.5">{t('admin.payroll.totalDays')}</p>
            <p className="text-2xl font-bold text-primary">{rows.length}</p>
          </div>
          <div className="bg-surface border border-[var(--border)] rounded-card p-4">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1.5">{t('admin.payroll.payrollTotal')}</p>
            <p className="text-2xl font-bold text-primary">{fmt$(grandTotal)}</p>
          </div>
          <div className="bg-surface border border-[var(--border)] rounded-card p-4">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1.5">Overtime</p>
            <p className={`text-2xl font-bold ${overtimeTotal > 0 ? 'text-amber' : 'text-primary'}`}>
              {fmt$(overtimeTotal)}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] mb-5 print:hidden">
        {(['detail', 'summary', 'overtime'] as const).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === tabKey
                ? 'border-brand text-primary'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {t(`admin.payroll.tab_${tabKey}`)}
            {tabKey === 'overtime' && overtimeRows.length > 0 && (
              <span className="ml-1.5 bg-amber/15 text-amber text-xs px-1.5 py-0.5 rounded-full font-semibold">
                {overtimeRows.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-[var(--border)] rounded-card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 mx-auto text-tertiary mb-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <p className="text-sm font-medium text-secondary">{t('admin.payroll.noData')}</p>
        </div>
      )}

      {/* ─── Detail tab ─── */}
      {!loading && rows.length > 0 && tab === 'detail' && (
        <div className="border border-[var(--border)] rounded-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[var(--color-surface-elevated)] border-b border-[var(--border)]">
                  <th className={TH}>{t('admin.payroll.col_employee')}</th>
                  <th className={TH}>{t('admin.payroll.col_date')}</th>
                  <th className={TH_R}>{t('admin.payroll.col_price')}</th>
                  <th className={`${TH} text-center`}>{t('admin.payroll.col_fullDay')}</th>
                  <th className={TH_R}>{t('admin.payroll.col_total')}</th>
                  <th className={TH}>{t('admin.payroll.col_notes')}</th>
                  <th className={TH}>{t('admin.payroll.col_job')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map(row => (
                  <tr key={row.entryId} className="hover:bg-[var(--color-surface-elevated)] transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-primary whitespace-nowrap">{row.personName}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                          row.payMode === 'daily'
                            ? 'bg-brand/10 text-brand'
                            : 'bg-surface-elevated text-secondary border border-[var(--border)]'
                        }`}>
                          {row.payMode === 'daily' ? '/day' : '/hr'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-secondary whitespace-nowrap">{fmtDate(row.date)}</td>
                    <td className="px-3 py-2.5 text-right text-secondary tabular-nums">
                      {row.payMode === 'daily' ? fmt$(row.dailyRate) : `${fmt$(row.hourlyRate)}/h`}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {row.payMode === 'daily' ? (
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                          row.fullDay ? 'bg-green/10 text-green' : 'bg-amber/10 text-amber'
                        }`}>
                          {row.fullDay ? 'Full' : 'Half'}
                        </span>
                      ) : (
                        <span className="text-secondary text-xs tabular-nums">
                          {row.hoursWorked != null ? `${row.hoursWorked.toFixed(1)}h` : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-primary tabular-nums">
                      {fmt$(row.totalPay)}
                    </td>
                    <td className="px-3 py-2.5 text-secondary max-w-[180px] truncate text-xs">{row.notes ?? ''}</td>
                    <td className="px-3 py-2.5 text-secondary whitespace-nowrap text-xs">{row.projectName}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--color-surface-elevated)] border-t border-[var(--border)]">
                  <td colSpan={4} className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-secondary">
                    {t('admin.payroll.grandTotal')}
                  </td>
                  <td className="px-3 py-2.5 text-right font-bold text-primary tabular-nums">{fmt$(grandTotal)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ─── Summary tab ─── */}
      {!loading && rows.length > 0 && tab === 'summary' && (
        <div className="border border-[var(--border)] rounded-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[var(--color-surface-elevated)] border-b border-[var(--border)]">
                  <th className={TH}>{t('admin.payroll.col_employee')}</th>
                  <th className={TH_R}>{t('admin.payroll.col_totalDays')}</th>
                  <th className={TH_R}>{t('admin.payroll.col_fullDays')}</th>
                  <th className={TH_R}>{t('admin.payroll.col_partialDays')}</th>
                  <th className={TH_R}>{t('admin.payroll.col_total')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {summaries.map(s => (
                  <tr key={s.personId} className="hover:bg-[var(--color-surface-elevated)] transition-colors">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-primary">{s.personName}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                          s.payMode === 'daily'
                            ? 'bg-brand/10 text-brand'
                            : 'bg-surface-elevated text-secondary border border-[var(--border)]'
                        }`}>
                          {s.payMode === 'daily' ? 'Daily' : 'Hourly'}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right text-secondary tabular-nums">{s.totalDays}</td>
                    <td className="px-3 py-3 text-right text-secondary tabular-nums">{s.fullDays}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {s.partialDays > 0 ? (
                        <span className="text-amber font-medium">{s.partialDays}</span>
                      ) : (
                        <span className="text-tertiary">0</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-bold text-primary tabular-nums">
                      {fmt$(s.totalPay)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-[var(--color-surface-elevated)] border-t border-[var(--border)]">
                  <td className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-secondary">
                    {t('admin.payroll.grandTotal')}
                  </td>
                  <td colSpan={3} />
                  <td className="px-3 py-2.5 text-right font-bold text-primary tabular-nums">
                    {fmt$(grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ─── Overtime tab ─── */}
      {!loading && tab === 'overtime' && (
        overtimeRows.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-[var(--border)] rounded-card">
            <p className="text-sm text-secondary">{t('admin.payroll.noOvertime')}</p>
          </div>
        ) : (
          <div className="border border-[var(--border)] rounded-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[var(--color-surface-elevated)] border-b border-[var(--border)]">
                    <th className={TH}>{t('admin.payroll.col_employee')}</th>
                    <th className={TH}>{t('admin.payroll.col_date')}</th>
                    <th className={TH_R}>{t('admin.payroll.col_price')}</th>
                    <th className={TH_R}>{t('admin.payroll.col_pricePerHr')}</th>
                    <th className={TH_R}>{t('admin.payroll.col_overtimeHrs')}</th>
                    <th className={TH_R}>{t('admin.payroll.col_overtimeTotal')}</th>
                    <th className={TH}>{t('admin.payroll.col_job')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {overtimeRows.map(row => (
                    <tr key={row.entryId} className="hover:bg-[var(--color-surface-elevated)] transition-colors">
                      <td className="px-3 py-2.5 font-medium text-primary whitespace-nowrap">{row.personName}</td>
                      <td className="px-3 py-2.5 text-secondary whitespace-nowrap">{fmtDate(row.date)}</td>
                      <td className="px-3 py-2.5 text-right text-secondary tabular-nums">{fmt$(row.dailyRate)}</td>
                      <td className="px-3 py-2.5 text-right text-secondary tabular-nums">
                        {fmt$(row.dailyRate / STANDARD_DAY_HOURS)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-amber tabular-nums">
                        {row.overtimeHours.toFixed(1)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold text-primary tabular-nums">
                        {fmt$(row.overtimePay)}
                      </td>
                      <td className="px-3 py-2.5 text-secondary whitespace-nowrap text-xs">{row.projectName}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[var(--color-surface-elevated)] border-t border-[var(--border)]">
                    <td colSpan={4} className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-secondary">
                      {t('admin.payroll.grandTotal')}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-amber tabular-nums">
                      {overtimeRows.reduce((s, r) => s + r.overtimeHours, 0).toFixed(1)}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-primary tabular-nums">
                      {fmt$(overtimeTotal)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      )}
    </div>
  )
}
