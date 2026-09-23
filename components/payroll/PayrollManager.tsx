'use client'

import { usePersistentState, oneOf } from '@/lib/use-persistent-state'
import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { calcEntryPay, STANDARD_DAY_HOURS } from '@/lib/payroll-calc'
import { finalizePayrollPeriod, getFinalizedPayrollPeriod } from '@/app/actions/payrollActions'
import {
  getPeriodRange,
  getPreviousPeriodRange,
  loadCompanyPeriodSettings,
  toDateStr,
  type CompanyPeriodSettings,
} from '@/lib/employee-period'
import { createManualCompensation, deleteManualCompensation, listManualCompensations, type CompensationCategory } from '@/app/actions/manualCompensationActions'

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
  payMode: 'daily' | 'hourly' | 'manual'
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

interface ManualCompRow {
  id: string
  personType: 'employee' | 'worker'
  personId: string
  personName: string
  amount: number
  date: string
  category: CompensationCategory
  description: string
  projectName: string | null
  locked: boolean
}

interface Person {
  id: string
  type: 'employee' | 'worker'
  name: string
}

const CATEGORY_LABELS: Record<CompensationCategory, string> = {
  extra_work: 'Extra Work',
  bonus: 'Bonus',
  correction: 'Correction',
  production: 'Production',
}

interface Summary {
  personId: string
  personName: string
  payMode: 'daily' | 'hourly' | 'manual'
  totalDays: number
  fullDays: number
  partialDays: number
  totalHours: number
  totalPay: number
  overtimePay: number
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

  const [tab, setTab] = usePersistentState<'detail' | 'summary' | 'overtime' | 'manual'>('payroll.tab', 'detail', oneOf(['detail', 'summary', 'overtime', 'manual'] as const))
  const [preset, setPreset] = useState<'current' | 'last' | 'custom'>('last')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [rows, setRows] = useState<DayRow[]>([])
  const [loading, setLoading] = useState(true)

  // Manual Compensation — extra work, bonuses, corrections, and
  // production-paid subcontractor pay. Kept in its own list, separate from
  // and auditable against the calculated Daily/Hourly rows above.
  const [manualRows, setManualRows] = useState<ManualCompRow[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [showAddManual, setShowAddManual] = useState(false)
  const [manualForm, setManualForm] = useState({
    personKey: '', amount: '', date: '', category: 'extra_work' as CompensationCategory, description: '', projectId: '',
  })
  const [manualSaving, setManualSaving] = useState(false)
  const [manualError, setManualError] = useState('')
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])

  // Finalized-period lock. Once a period is finalized, its numbers are read
  // from the permanent snapshot instead of recomputed live, so later rate or
  // Pay System changes can never move a paid period's numbers.
  const [finalized, setFinalized] = useState(false)
  const [finalizedAt, setFinalizedAt] = useState<string | null>(null)
  const [finalizedByName, setFinalizedByName] = useState<string | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  const [finalizeError, setFinalizeError] = useState('')

  // The company's saved pay period (Settings → Pay Period, or "Save as pay
  // period" below) drives Last/Current Pay Period, the same range employees
  // see on Home / Days / Pay.
  const [periodSettings, setPeriodSettings] = useState<CompanyPeriodSettings | null>(null)
  const [periodSaving, setPeriodSaving] = useState(false)
  const [periodSaveMsg, setPeriodSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!companyId) return
    loadCompanyPeriodSettings(createClient(), companyId).then(setPeriodSettings)
  }, [companyId])

  const presetRange = (() => {
    if (!periodSettings || preset === 'custom') return null
    const r = preset === 'current'
      ? getPeriodRange(periodSettings.periodType, new Date(), periodSettings.anchor)
      : getPreviousPeriodRange(periodSettings.periodType, new Date(), periodSettings.anchor)
    return { start: toDateStr(r.start), end: toDateStr(r.end) }
  })()
  // Remember the last range the admin picked (Last / Current / Custom and the
  // custom dates) so leaving Payroll and coming back keeps it, instead of
  // snapping back to the default. Per browser, per company; best-effort.
  const rangeKey = `orbit.payroll.range.${companyId}`
  const [rangeRestored, setRangeRestored] = useState(false)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(rangeKey) ?? 'null')
      if (saved && (saved.preset === 'current' || saved.preset === 'last' || saved.preset === 'custom')) {
        if (saved.preset === 'custom' && saved.start && saved.end) {
          setCustomStart(saved.start)
          setCustomEnd(saved.end)
          setPreset('custom')
        } else if (saved.preset !== 'custom') {
          setPreset(saved.preset)
        }
      }
    } catch { /* storage unavailable — keep defaults */ }
    setRangeRestored(true)
  }, [rangeKey])
  useEffect(() => {
    if (!rangeRestored) return
    try {
      localStorage.setItem(rangeKey, JSON.stringify({ preset, start: customStart, end: customEnd }))
    } catch { /* ignore */ }
  }, [rangeRestored, rangeKey, preset, customStart, customEnd])

  // Nothing loads until the remembered range is restored, so the screen
  // doesn't flash the default period first.
  const periodStart = !rangeRestored ? '' : preset === 'custom' ? customStart : (presetRange?.start ?? '')
  const periodEnd   = !rangeRestored ? '' : preset === 'custom' ? customEnd   : (presetRange?.end ?? '')

  // Saves the custom range as the company's recurring pay period: a 7-day
  // range becomes Weekly and a 14-day range Bi-weekly, both starting on the
  // chosen start date and repeating from there.
  async function savePeriodAsDefault() {
    setPeriodSaveMsg(null)
    if (!customStart || !customEnd || !companyId) return
    const days = Math.round(
      (new Date(customEnd + 'T00:00:00').getTime() - new Date(customStart + 'T00:00:00').getTime()) / 86400000,
    ) + 1
    const periodType = days === 7 ? 'weekly' : days === 14 ? 'biweekly' : null
    if (!periodType) {
      setPeriodSaveMsg({ ok: false, text: `A recurring pay period must be 7 or 14 days long (this range is ${days} days).` })
      return
    }
    setPeriodSaving(true)
    const supabase = createClient()
    const values = { home_period_type: periodType, pay_period_anchor: customStart }
    const { data: existing } = await supabase
      .from('company_document_settings').select('id').eq('company_id', companyId).maybeSingle()
    const { error } = existing
      ? await supabase.from('company_document_settings').update(values).eq('company_id', companyId)
      : await supabase.from('company_document_settings').insert({ company_id: companyId, ...values })
    setPeriodSaving(false)
    if (error) {
      setPeriodSaveMsg({ ok: false, text: 'Could not save the pay period. Please try again.' })
      return
    }
    setPeriodSettings({ periodType, anchor: customStart })
    setPreset('current')
    setPeriodSaveMsg({ ok: true, text: `Saved: ${periodType === 'weekly' ? 'weekly' : 'every 2 weeks'}, starting ${fmtDateLong(customStart)}.` })
  }

  const load = useCallback(async () => {
    if (!periodStart || !periodEnd) return
    setLoading(true)
    setFinalizeError('')

    const snapshot = await getFinalizedPayrollPeriod(periodStart, periodEnd)
    if (snapshot.finalized) {
      setFinalized(true)
      setFinalizedAt(snapshot.finalizedAt)
      setFinalizedByName(snapshot.finalizedByName)
      setRows(snapshot.entries.filter(e => e.pay_mode !== 'manual').map((e): DayRow => ({
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
      setManualRows(snapshot.entries.filter(e => e.pay_mode === 'manual').map((e): ManualCompRow => ({
        id: e.id,
        personType: e.person_type,
        personId: e.person_id,
        personName: e.person_name,
        amount: Number(e.total_pay),
        date: e.entry_date,
        category: (e.category ?? 'extra_work') as CompensationCategory,
        description: e.notes ?? '',
        projectName: e.project_name,
        locked: true,
      })))
      setLoading(false)
      return
    }
    setFinalized(false)
    setFinalizedAt(null)
    setFinalizedByName(null)

    const manualResult = await listManualCompensations(periodStart, periodEnd)
    if (manualResult.success) {
      setManualRows(manualResult.entries.map((m): ManualCompRow => ({
        id: m.id as string,
        personType: m.person_type as 'employee' | 'worker',
        personId: m.person_id as string,
        personName: m.person_name as string,
        amount: Number(m.amount),
        date: m.compensation_date as string,
        category: m.category as CompensationCategory,
        description: m.description as string,
        projectName: (m.project as unknown as { name: string } | null)?.name ?? null,
        locked: m.payroll_period_id != null,
      })))
    }

    const supabase = createClient()

    const { data: entries } = await supabase
      .from('time_entries')
      .select(`
        id, clock_in, clock_out, is_full_day, notes, employee_id, worker_id,
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

  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    Promise.all([
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId).eq('role', 'employee').eq('status', 'active').order('full_name'),
      supabase.from('workers').select('id, full_name').eq('company_id', companyId).eq('status', 'active').order('full_name'),
      supabase.from('projects').select('id, name').eq('company_id', companyId).order('name'),
    ]).then(([{ data: emps }, { data: wrks }, { data: projs }]) => {
      const combined: Person[] = [
        ...((emps ?? []) as { id: string; full_name: string }[]).map(e => ({ id: e.id, type: 'employee' as const, name: e.full_name })),
        ...((wrks ?? []) as { id: string; full_name: string }[]).map(w => ({ id: w.id, type: 'worker' as const, name: w.full_name })),
      ]
      setPeople(combined)
      setProjects(projs ?? [])
    })
  }, [companyId])

  function openAddManual() {
    setManualForm({ personKey: '', amount: '', date: periodEnd || new Date().toISOString().slice(0, 10), category: 'extra_work', description: '', projectId: '' })
    setManualError('')
    setShowAddManual(true)
  }

  async function handleAddManual(e: React.FormEvent) {
    e.preventDefault()
    const person = people.find(p => `${p.type}:${p.id}` === manualForm.personKey)
    if (!person) { setManualError('Select a person.'); return }
    const amount = Number(manualForm.amount)
    if (!amount || amount <= 0) { setManualError('Enter an amount greater than 0.'); return }
    if (!manualForm.description.trim()) { setManualError('A description is required.'); return }
    if (!manualForm.date) { setManualError('Select a date.'); return }

    setManualSaving(true)
    setManualError('')
    const result = await createManualCompensation({
      person_type: person.type,
      person_id: person.id,
      person_name: person.name,
      amount,
      compensation_date: manualForm.date,
      category: manualForm.category,
      description: manualForm.description.trim(),
      project_id: manualForm.projectId || null,
    })
    setManualSaving(false)
    if (result.error) { setManualError(result.error); return }
    setShowAddManual(false)
    await load()
  }

  async function handleDeleteManual(id: string) {
    if (!window.confirm('Delete this manual compensation entry?')) return
    const result = await deleteManualCompensation(id)
    if (result.error) { window.alert(result.error); return }
    await load()
  }

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
      acc[row.personId].totalDays   += row.payMode === 'daily' ? (row.fullDay ? 1 : 0.5) : 1
      acc[row.personId].fullDays    += row.fullDay ? 1 : 0
      acc[row.personId].partialDays += row.fullDay ? 0 : 1
      acc[row.personId].totalHours  += row.hoursWorked ?? 0
      acc[row.personId].totalPay    += row.totalPay
      acc[row.personId].overtimePay += row.overtimePay
      return acc
    }, {} as Record<string, Summary>)
  ).sort((a, b) => a.personName.localeCompare(b.personName))

  const overtimeRows = rows.filter(r => r.overtimeHours > 0)
  const calculatedTotal = summaries.reduce((s, r) => s + r.totalPay, 0)
  const overtimeTotal   = summaries.reduce((s, r) => s + r.overtimePay, 0)
  const manualCompTotal = manualRows.reduce((s, r) => s + r.amount, 0)
  const grandTotal      = calculatedTotal + manualCompTotal
  const hasAnyData      = rows.length > 0 || manualRows.length > 0

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
    const manualDataRows = manualRows.map(m => [
      m.personName,
      'Manual',
      '—',
      fmtDate(m.date),
      '—',
      '—',
      '—',
      m.amount.toFixed(2),
      `${CATEGORY_LABELS[m.category]}: ${m.description}`,
      m.projectName ?? '',
    ])
    const csv = [header, ...dataRows, ...manualDataRows].map(row => row.map(escapeCSV).join(',')).join('\n')
    const label = periodStart && periodEnd ? `${periodStart}_to_${periodEnd}` : 'payroll'
    downloadCSV(`Payroll_${label}.csv`, csv)
  }

  function printInvoice() {
    const periodLabel = periodStart && periodEnd ? `${fmtDateLong(periodStart)} to ${fmtDateLong(periodEnd)}` : ''

    const perPerson = summaries.map(s => {
      const personRows = rows.filter(r => r.personId === s.personId)
      const personManual = manualRows.filter(m => m.personId === s.personId)
      const hasOvertime = s.overtimePay > 0
      const manualTotal = personManual.reduce((sum, m) => sum + m.amount, 0)

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

      const manualCompRows = personManual.map(m =>
        `<tr>
          <td class="tag manual">MANUAL</td>
          <td class="desc">${fmtDate(m.date)} · ${CATEGORY_LABELS[m.category]}${m.projectName ? ' · ' + m.projectName : ''} · ${m.description}</td>
          <td class="amount">${fmt$(m.amount)}</td>
        </tr>`
      ).join('')

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
              ${manualCompRows}
            </tbody>
            <tfoot>
              <tr class="subtotal">
                <td colspan="2">SUBTOTAL</td>
                <td class="amount">${fmt$(s.totalPay + s.overtimePay + manualTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>`
    }).join('')

    // People who ONLY have manual compensation (e.g. a production-paid
    // subcontractor with no clock-in at all) get their own section, since
    // they never appear in `summaries`.
    const manualOnlyPeople = Array.from(new Set(
      manualRows.filter(m => !summaries.some(s => s.personId === m.personId)).map(m => m.personId)
    ))
    const manualOnlySections = manualOnlyPeople.map(personId => {
      const personManual = manualRows.filter(m => m.personId === personId)
      const personName = personManual[0]?.personName ?? 'Unknown'
      const manualTotal = personManual.reduce((sum, m) => sum + m.amount, 0)
      const manualCompRows = personManual.map(m =>
        `<tr>
          <td class="tag manual">MANUAL</td>
          <td class="desc">${fmtDate(m.date)} · ${CATEGORY_LABELS[m.category]}${m.projectName ? ' · ' + m.projectName : ''} · ${m.description}</td>
          <td class="amount">${fmt$(m.amount)}</td>
        </tr>`
      ).join('')
      return `
        <div class="section">
          <h2 class="name">${personName} <span class="pay-type">Manual Compensation</span></h2>
          <table>
            <thead>
              <tr class="th-row">
                <th>TYPE</th><th>DESCRIPTION</th><th>AMOUNT</th>
              </tr>
            </thead>
            <tbody>${manualCompRows}</tbody>
            <tfoot>
              <tr class="subtotal">
                <td colspan="2">SUBTOTAL</td>
                <td class="amount">${fmt$(manualTotal)}</td>
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
  .tag.manual { background: #f0e5ff; color: #6600cc; }
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
    <div class="value">${new Set([...rows.map(r => r.personId), ...manualRows.map(r => r.personId)]).size}</div>
  </div>
  <div class="total-box">
    <div class="label">Payroll Total</div>
    <div class="value">${fmt$(calculatedTotal)}</div>
  </div>
  <div class="total-box">
    <div class="label">Overtime Total</div>
    <div class="value">${fmt$(overtimeTotal)}</div>
  </div>
  <div class="total-box">
    <div class="label">Manual Comp Total</div>
    <div class="value">${fmt$(manualCompTotal)}</div>
  </div>
  <div class="total-box">
    <div class="label">Invoice Total</div>
    <div class="value">${fmt$(grandTotal + overtimeTotal)}</div>
  </div>
</div>
${perPerson}
${manualOnlySections}
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
          {hasAnyData && (
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
              onClick={() => {
                if (opt.value === 'custom' && (!customStart || !customEnd) && periodStart && periodEnd) {
                  setCustomStart(periodStart)
                  setCustomEnd(periodEnd)
                }
                setPreset(opt.value as typeof preset)
              }}
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
            <button
              type="button"
              onClick={savePeriodAsDefault}
              disabled={periodSaving || !customStart || !customEnd}
              className="px-3 py-2 rounded-button bg-brand text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {periodSaving ? 'Saving…' : 'Save as pay period'}
            </button>
          </div>
        )}
        {periodSaveMsg && (
          <p className={`w-full text-xs ${periodSaveMsg.ok ? 'text-green' : 'text-danger'}`}>{periodSaveMsg.text}</p>
        )}
      </div>

      {/* Stats cards */}
      {!loading && hasAnyData && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="bg-surface border border-[var(--border)] rounded-card p-4">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1.5">{t('admin.payroll.totalWorkers')}</p>
            <p className="text-2xl font-bold text-primary">{new Set([...rows.map(r => r.personId), ...manualRows.map(r => r.personId)]).size}</p>
          </div>
          <div className="bg-surface border border-[var(--border)] rounded-card p-4">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1.5">{t('admin.payroll.totalDays')}</p>
            <p className="text-2xl font-bold text-primary">{summaries.reduce((s, x) => s + x.totalDays, 0)}</p>
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
          <div className="bg-surface border border-[var(--border)] rounded-card p-4">
            <p className="text-xs text-secondary uppercase tracking-wide mb-1.5">Manual Comp</p>
            <p className={`text-2xl font-bold ${manualCompTotal > 0 ? 'text-brand' : 'text-primary'}`}>
              {fmt$(manualCompTotal)}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)] mb-5 print:hidden">
        {(['detail', 'summary', 'overtime', 'manual'] as const).map(tabKey => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === tabKey
                ? 'border-brand text-primary'
                : 'border-transparent text-secondary hover:text-primary'
            }`}
          >
            {tabKey === 'manual' ? 'Manual Comp' : t(`admin.payroll.tab_${tabKey}`)}
            {tabKey === 'overtime' && overtimeRows.length > 0 && (
              <span className="ml-1.5 bg-amber/15 text-amber text-xs px-1.5 py-0.5 rounded-full font-semibold">
                {overtimeRows.length}
              </span>
            )}
            {tabKey === 'manual' && manualRows.length > 0 && (
              <span className="ml-1.5 bg-brand/15 text-brand text-xs px-1.5 py-0.5 rounded-full font-semibold">
                {manualRows.length}
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

      {!loading && rows.length === 0 && tab !== 'manual' && (
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
                  <td className="px-3 py-2.5 text-right font-bold text-primary tabular-nums">{fmt$(calculatedTotal)}</td>
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
                    {fmt$(calculatedTotal)}
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

      {/* ─── Manual Compensation tab ─── */}
      {!loading && tab === 'manual' && (
        <div>
          <div className="flex justify-end mb-3 print:hidden">
            <button
              onClick={openAddManual}
              className="flex items-center gap-1.5 px-3 py-2 rounded-button bg-brand text-white text-sm hover:opacity-90 transition-opacity"
            >
              + Add Manual Compensation
            </button>
          </div>
          {manualRows.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-[var(--border)] rounded-card">
              <p className="text-sm text-secondary">No manual compensation entries for this period — extra work, bonuses, corrections, or production-paid subcontractor pay.</p>
            </div>
          ) : (
            <div className="border border-[var(--border)] rounded-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-[var(--color-surface-elevated)] border-b border-[var(--border)]">
                      <th className={TH}>{t('admin.payroll.col_employee')}</th>
                      <th className={TH}>{t('admin.payroll.col_date')}</th>
                      <th className={TH}>Category</th>
                      <th className={TH}>Description</th>
                      <th className={TH}>{t('admin.payroll.col_job')}</th>
                      <th className={TH_R}>{t('admin.payroll.col_total')}</th>
                      <th className={TH_R}> </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {manualRows.map(row => (
                      <tr key={row.id} className="hover:bg-[var(--color-surface-elevated)] transition-colors">
                        <td className="px-3 py-2.5 font-medium text-primary whitespace-nowrap">
                          {row.personName}
                          {row.locked && (
                            <span className="ml-1.5 text-[10px] text-tertiary" title="Part of a finalized payroll period">🔒</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-secondary whitespace-nowrap">{fmtDate(row.date)}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-brand/10 text-brand">
                            {CATEGORY_LABELS[row.category]}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-secondary max-w-[240px] truncate text-xs">{row.description}</td>
                        <td className="px-3 py-2.5 text-secondary whitespace-nowrap text-xs">{row.projectName ?? '—'}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-primary tabular-nums">{fmt$(row.amount)}</td>
                        <td className="px-3 py-2.5 text-right print:hidden">
                          {!row.locked && (
                            <button
                              onClick={() => handleDeleteManual(row.id)}
                              className="text-tertiary hover:text-danger transition-colors text-xs"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--color-surface-elevated)] border-t border-[var(--border)]">
                      <td colSpan={5} className="px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-secondary">
                        {t('admin.payroll.grandTotal')}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-primary tabular-nums">{fmt$(manualCompTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Add Manual Compensation modal ─── */}
      {showAddManual && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowAddManual(false)}>
          <div className="bg-surface rounded-card max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-primary mb-4">Add Manual Compensation</h2>
            <form onSubmit={handleAddManual} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-secondary mb-1 block">Person</label>
                <select
                  value={manualForm.personKey}
                  onChange={e => setManualForm(f => ({ ...f, personKey: e.target.value }))}
                  className="w-full text-sm rounded-button border border-[var(--border)] px-2.5 py-2 bg-surface text-primary"
                  required
                >
                  <option value="">Select person…</option>
                  <optgroup label="Employees">
                    {people.filter(p => p.type === 'employee').map(p => (
                      <option key={`employee:${p.id}`} value={`employee:${p.id}`}>{p.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Workers (no login)">
                    {people.filter(p => p.type === 'worker').map(p => (
                      <option key={`worker:${p.id}`} value={`worker:${p.id}`}>{p.name}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-secondary mb-1 block">Amount ($)</label>
                  <input
                    type="number" min="0.01" step="0.01" required
                    value={manualForm.amount}
                    onChange={e => setManualForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full text-sm rounded-button border border-[var(--border)] px-2.5 py-2 bg-surface text-primary"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-secondary mb-1 block">Date</label>
                  <input
                    type="date" required
                    value={manualForm.date}
                    onChange={e => setManualForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full text-sm rounded-button border border-[var(--border)] px-2.5 py-2 bg-surface text-primary"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-secondary mb-1 block">Category</label>
                <select
                  value={manualForm.category}
                  onChange={e => setManualForm(f => ({ ...f, category: e.target.value as CompensationCategory }))}
                  className="w-full text-sm rounded-button border border-[var(--border)] px-2.5 py-2 bg-surface text-primary"
                >
                  {(Object.keys(CATEGORY_LABELS) as CompensationCategory[]).map(cat => (
                    <option key={cat} value={cat}>{CATEGORY_LABELS[cat]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-secondary mb-1 block">Project (optional)</label>
                <select
                  value={manualForm.projectId}
                  onChange={e => setManualForm(f => ({ ...f, projectId: e.target.value }))}
                  className="w-full text-sm rounded-button border border-[var(--border)] px-2.5 py-2 bg-surface text-primary"
                >
                  <option value="">—</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-secondary mb-1 block">Description</label>
                <textarea
                  required
                  value={manualForm.description}
                  onChange={e => setManualForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Rooms completed / production work — Hampton Inn Beckley"
                  className="w-full text-sm rounded-button border border-[var(--border)] px-2.5 py-2 bg-surface text-primary resize-none"
                  rows={2}
                />
              </div>
              {manualError && <p className="text-xs text-danger">{manualError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddManual(false)}
                  className="flex-1 px-3 py-2 rounded-button border border-[var(--border)] text-sm text-secondary hover:text-primary transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={manualSaving}
                  className="flex-1 px-3 py-2 rounded-button bg-brand text-white text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {manualSaving ? 'Saving…' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
