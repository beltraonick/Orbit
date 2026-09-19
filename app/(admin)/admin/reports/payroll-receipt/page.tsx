import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

const fmt$ = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function periodDates(period: string): { start: Date | null; end: Date | null } {
  const now = new Date()
  if (period === 'week') {
    const d = new Date(now)
    d.setDate(now.getDate() - now.getDay())
    d.setHours(0, 0, 0, 0)
    return { start: d, end: null }
  }
  if (period === 'last_week') {
    const s = new Date(now)
    s.setDate(now.getDate() - now.getDay() - 7)
    s.setHours(0, 0, 0, 0)
    const e = new Date(now)
    e.setDate(now.getDate() - now.getDay() - 1)
    e.setHours(23, 59, 59, 999)
    return { start: s, end: e }
  }
  if (period === 'month') {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null }
  }
  if (period === 'last_month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
    }
  }
  return { start: null, end: null }
}

function periodLabel(start: Date | null, end: Date | null): string {
  if (!start) return 'All Time'
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })
  return `${fmt(start)} – ${fmt(end ?? new Date())}`
}

const printCss = `
@media print {
  body * { visibility: hidden !important; }
  #receipt-root, #receipt-root * { visibility: visible !important; }
  #receipt-root { position: fixed; inset: 0; padding: 0.5in; }
  .no-print { display: none !important; }
  @page { size: letter; margin: 0; }
}
`

export default async function PayrollReceiptPage({
  searchParams,
}: {
  searchParams: { period?: string }
}) {
  const user = getCurrentUser()
  if (!user) redirect('/login')
  if (user.role !== 'admin' && user.role !== 'owner') redirect('/dashboard')

  const period = searchParams.period ?? 'month'
  const { start, end } = periodDates(period)
  const supabase = createClient()
  const cid = user.company_id

  let teQuery = supabase
    .from('time_entries')
    .select(
      'employee_id, clock_in, clock_out, profile:employee_id(full_name, daily_rate), project:project_id(name)',
    )
    .eq('company_id', cid)
    .not('clock_out', 'is', null)
    .order('clock_in')
    .limit(2000)
  if (start) teQuery = teQuery.gte('clock_in', start.toISOString())
  if (end) teQuery = teQuery.lte('clock_in', end.toISOString())

  let expQuery = supabase
    .from('expenses')
    .select(
      'description, amount, approval_status, submitted_by:submitted_by_profile_id(full_name)',
    )
    .eq('company_id', cid)
    .eq('approval_status', 'approved')
    .limit(1000)
  if (start) expQuery = expQuery.gte('expense_date', start.toISOString().slice(0, 10))
  if (end) expQuery = expQuery.lte('expense_date', end.toISOString().slice(0, 10))

  let milQuery = supabase
    .from('mileage_trips')
    .select(
      'origin, destination, reimbursement_amount, approval_status, employee:employee_profile_id(full_name)',
    )
    .eq('company_id', cid)
    .eq('approval_status', 'approved')
    .limit(1000)
  if (start) milQuery = milQuery.gte('trip_date', start.toISOString().slice(0, 10))
  if (end) milQuery = milQuery.lte('trip_date', end.toISOString().slice(0, 10))

  const [{ data: company }, { data: rawEntries }, { data: rawExpenses }, { data: rawMileage }] =
    await Promise.all([
      supabase.from('companies').select('name').eq('id', cid).single(),
      teQuery,
      expQuery,
      milQuery,
    ])

  type RawEntry = {
    clock_in: string
    clock_out: string
    profile: { full_name: string; daily_rate: number } | null
    project: { name: string } | null
  }
  type RawExpense = {
    description: string
    amount: number
    submitted_by: { full_name: string } | null
  }
  type RawMileage = {
    origin: string
    destination: string
    reimbursement_amount: number
    employee: { full_name: string } | null
  }

  // Build per-employee payroll map
  const empPayMap = new Map<string, number>()
  for (const e of (rawEntries ?? []) as unknown as RawEntry[]) {
    const name = e.profile?.full_name ?? '—'
    const hours = (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 3600000
    const rate = Number(e.profile?.daily_rate ?? 0)
    const pay = hours >= 7 ? rate : Math.round((hours / 8) * rate * 100) / 100
    empPayMap.set(name, (empPayMap.get(name) ?? 0) + pay)
  }

  // Build per-employee expense list
  const empExpMap = new Map<string, { description: string; amount: number }[]>()
  for (const e of (rawExpenses ?? []) as unknown as RawExpense[]) {
    const name = e.submitted_by?.full_name ?? '—'
    if (!empExpMap.has(name)) empExpMap.set(name, [])
    empExpMap.get(name)!.push({ description: e.description, amount: Number(e.amount) })
  }

  // Build per-employee mileage list
  const empMilMap = new Map<string, { route: string; amount: number }[]>()
  for (const m of (rawMileage ?? []) as unknown as RawMileage[]) {
    const name = m.employee?.full_name ?? '—'
    if (!empMilMap.has(name)) empMilMap.set(name, [])
    empMilMap.get(name)!.push({
      route: `${m.origin} → ${m.destination}`,
      amount: Number(m.reimbursement_amount),
    })
  }

  // All employee names across payroll + expenses + mileage
  const allNames = Array.from(
    new Set(
      [...Array.from(empPayMap.keys()), ...Array.from(empExpMap.keys()), ...Array.from(empMilMap.keys())],
    ),
  ).sort()

  const totalPayroll = Array.from(empPayMap.values()).reduce((s, v) => s + v, 0)
  const totalReimb =
    Array.from(empExpMap.values()).flat().reduce((s, e) => s + e.amount, 0) +
    Array.from(empMilMap.values()).flat().reduce((s, m) => s + m.amount, 0)
  const grandTotal = totalPayroll + totalReimb

  const companyName = (company as { name: string } | null)?.name ?? 'Company'
  const receiptNumber = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const today = new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const payPeriod = periodLabel(start, end)

  return (
    <div className="p-4 md:p-6">
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: printCss }} />

      <div className="no-print flex gap-3 mb-6">
        <button
          onClick={undefined}
          data-action="print"
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
          suppressHydrationWarning
        >
          Print / Save as PDF
        </button>
        <a href={`/admin/reports?period=${period}`} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
          ← Back to Reports
        </a>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `document.querySelector('[data-action="print"]').addEventListener('click',()=>window.print())`,
        }}
      />

      <div id="receipt-root" className="bg-white text-gray-900 font-sans max-w-[780px] mx-auto">
        {/* Header */}
        <div className="flex justify-between items-start border-b-2 border-gray-800 pb-4 mb-5">
          <div>
            <div className="text-xl font-bold tracking-tight">{companyName}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tracking-widest text-gray-800">PAYMENT RECEIPT</div>
            <div className="text-xs text-gray-500 mt-1">Receipt #: {receiptNumber}</div>
            <div className="text-xs text-gray-500">Transaction Date: {today}</div>
            <div className="text-xs text-gray-500">Payment Form: ACH</div>
            <div className="text-xs text-gray-500">Pay Period: {payPeriod}</div>
          </div>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'PAYROLL TOTAL', value: totalPayroll },
            { label: 'REIMBURSEMENT TOTAL', value: totalReimb },
            { label: 'INVOICE TOTAL', value: grandTotal },
          ].map(tile => (
            <div key={tile.label} className="border border-gray-200 rounded p-3">
              <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-400 mb-1">
                {tile.label}
              </div>
              <div className="text-lg font-bold">{fmt$(tile.value)}</div>
            </div>
          ))}
        </div>

        {/* Per-employee sections */}
        {allNames.map(name => {
          const payroll = empPayMap.get(name) ?? 0
          const exps = empExpMap.get(name) ?? []
          const mils = empMilMap.get(name) ?? []
          const subtotal =
            payroll +
            exps.reduce((s, e) => s + e.amount, 0) +
            mils.reduce((s, m) => s + m.amount, 0)

          return (
            <div key={name} className="mb-5">
              <div className="text-sm font-bold border-b border-gray-300 pb-1 mb-2">{name}</div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="text-left px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500 w-[18%]">
                      Type
                    </th>
                    <th className="text-left px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500">
                      Description
                    </th>
                    <th className="text-right px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500 w-[15%]">
                      Amount
                    </th>
                    <th className="text-right px-2 py-1.5 font-semibold uppercase tracking-wide text-gray-500 w-[15%]">
                      Subtotal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payroll > 0 && (
                    <tr className="border-b border-gray-100">
                      <td className="px-2 py-1.5 text-gray-600">PAYROLL</td>
                      <td className="px-2 py-1.5">{payPeriod} Pay</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt$(payroll)}</td>
                      <td className="px-2 py-1.5" />
                    </tr>
                  )}
                  {exps.map((exp, i) => (
                    <tr key={`exp-${i}`} className="border-b border-gray-100">
                      <td className="px-2 py-1.5 text-gray-600">REIMBURSEMENT</td>
                      <td className="px-2 py-1.5">{exp.description}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt$(exp.amount)}</td>
                      <td className="px-2 py-1.5" />
                    </tr>
                  ))}
                  {mils.map((mil, i) => (
                    <tr key={`mil-${i}`} className="border-b border-gray-100">
                      <td className="px-2 py-1.5 text-gray-600">MILEAGE</td>
                      <td className="px-2 py-1.5">{mil.route}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt$(mil.amount)}</td>
                      <td className="px-2 py-1.5" />
                    </tr>
                  ))}
                  <tr className="border-t border-gray-300">
                    <td colSpan={3} />
                    <td className="px-2 py-1.5 text-right font-bold tabular-nums">{fmt$(subtotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )
        })}

        {/* Grand Total */}
        <div className="border-t-2 border-gray-800 mt-4 pt-3 flex justify-end">
          <div className="flex gap-8 items-baseline">
            <span className="text-sm font-bold uppercase tracking-widest">TOTAL</span>
            <span className="text-xl font-bold tabular-nums">{fmt$(grandTotal)}</span>
          </div>
        </div>

        {/* Signature */}
        <div className="mt-10 pt-2">
          <div className="border-t border-gray-500 w-60 pt-1">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide">
              Client Representative
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-[9px] text-gray-300 border-t border-gray-100 pt-3">
          {companyName}
        </div>
      </div>
    </div>
  )
}
