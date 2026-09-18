'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import {
  getExpenses,
  approveExpense,
  rejectExpense,
  flagExpenseForReview,
} from '@/app/actions/expenseActions'
import {
  getMileageTrips,
  approveMileageTrip,
  rejectMileageTrip,
} from '@/app/actions/mileageActions'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExpenseItem {
  kind: 'expense'
  id: string
  label: string
  amount: number
  date: string
  submitter: string
  status: string
  hasReceipt: boolean
  reviewer_notes: string | null
}

interface MileageItem {
  kind: 'mileage'
  id: string
  label: string
  amount: number
  distance: number
  date: string
  submitter: string
  status: string
  reviewer_notes: string | null
}

type ApprovalItem = ExpenseItem | MileageItem
type TypeFilter = 'all' | 'expenses' | 'mileage'

const fmt$ = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const fmtMi = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} mi`

// ─── Component ────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const { t } = useTranslation()
  const a = (k: string) => t(`admin.approvals.${k}`)

  const [items, setItems] = useState<ApprovalItem[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchSaving, setBatchSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [expRes, milRes] = await Promise.all([
      getExpenses('pending'),
      getMileageTrips('pending'),
    ])

    const expItems: ExpenseItem[] = ((expRes.expenses ?? []) as unknown as Array<{
      id: string; description: string; amount: number; expense_date: string;
      submitted_by: { full_name: string } | null; approval_status: string;
      receipt: unknown | null; reviewer_notes: string | null
    }>).map(e => ({
      kind: 'expense',
      id: e.id,
      label: e.description,
      amount: e.amount,
      date: e.expense_date,
      submitter: e.submitted_by?.full_name ?? '—',
      status: e.approval_status,
      hasReceipt: !!e.receipt,
      reviewer_notes: e.reviewer_notes,
    }))

    const milItems: MileageItem[] = ((milRes.trips ?? []) as unknown as Array<{
      id: string; origin: string; destination: string; reimbursement_amount: number;
      distance_miles: number; trip_date: string; employee: { full_name: string } | null;
      approval_status: string; reviewer_notes: string | null
    }>).map(m => ({
      kind: 'mileage',
      id: m.id,
      label: `${m.origin} → ${m.destination}`,
      amount: m.reimbursement_amount,
      distance: m.distance_miles,
      date: m.trip_date,
      submitter: m.employee?.full_name ?? '—',
      status: m.approval_status,
      reviewer_notes: m.reviewer_notes,
    }))

    const all: ApprovalItem[] = [...expItems, ...milItems].sort((a, b) => b.date.localeCompare(a.date))
    setItems(all)
    setLoading(false)
    setSelected(new Set())
  }, [])

  useEffect(() => { load() }, [load])

  const displayed = items.filter(item =>
    typeFilter === 'all' ? true :
    typeFilter === 'expenses' ? item.kind === 'expense' :
    item.kind === 'mileage'
  )

  async function handleApprove(item: ApprovalItem, notes?: string) {
    if (item.kind === 'expense') await approveExpense(item.id, notes)
    else await approveMileageTrip(item.id, notes)
    setReviewingId(null)
    setReviewNotes('')
    load()
  }

  async function handleReject(item: ApprovalItem, notes?: string) {
    if (item.kind === 'expense') await rejectExpense(item.id, notes)
    else await rejectMileageTrip(item.id, notes)
    setReviewingId(null)
    setReviewNotes('')
    load()
  }

  async function handleFlag(item: ApprovalItem) {
    if (item.kind === 'expense') await flagExpenseForReview(item.id)
    load()
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  function toggleAll() {
    if (selected.size === displayed.length) setSelected(new Set())
    else setSelected(new Set(displayed.map(i => i.id)))
  }

  async function batchAction(action: 'approve' | 'reject') {
    if (!selected.size) return
    const count = selected.size
    if (!confirm(`${action === 'approve' ? a('confirmBatchApprove') : a('confirmBatchReject')}`.replace('{n}', String(count)))) return

    setBatchSaving(true)
    const promises = displayed
      .filter(item => selected.has(item.id))
      .map(item => action === 'approve' ? handleApprove(item) : handleReject(item))
    await Promise.all(promises)
    setBatchSaving(false)
    setSelected(new Set())
  }

  const filters: { key: TypeFilter; label: string }[] = [
    { key: 'all', label: a('filterAll') },
    { key: 'expenses', label: a('filterExpenses') },
    { key: 'mileage', label: a('filterMileage') },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{a('title')}</h1>
        <p className="text-sm text-gray-500 mt-0.5">{a('subtitle')}</p>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setTypeFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              typeFilter === f.key
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Batch controls */}
      {displayed.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={toggleAll} className="text-sm text-blue-500 underline">
            {selected.size === displayed.length ? a('deselectAll') : a('selectAll')}
          </button>
          {selected.size > 0 && (
            <>
              <span className="text-sm text-gray-500">{a('selected').replace('{n}', String(selected.size))}</span>
              <Button size="sm" onClick={() => batchAction('approve')} disabled={batchSaving}>{a('batchApprove')}</Button>
              <Button size="sm" variant="ghost" onClick={() => batchAction('reject')} disabled={batchSaving}>{a('batchReject')}</Button>
            </>
          )}
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>
      ) : displayed.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">{a('noApprovals')}</p>
      ) : (
        <div className="space-y-3">
          {displayed.map(item => (
            <Card key={item.id} className={`p-4 ${selected.has(item.id) ? 'ring-2 ring-blue-500' : ''}`}>
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{item.label}</span>
                    <Badge variant={item.kind === 'expense' ? 'blue' : 'default'}>
                      {item.kind === 'expense' ? a('typeExpense') : a('typeMileage')}
                    </Badge>
                    {item.status === 'needs_review' && <Badge variant="amber">{a('statusNeedsReview')}</Badge>}
                    {'hasReceipt' in item && !item.hasReceipt && (
                      <span className="text-xs text-gray-400">{a('noReceipt')}</span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                    <span>{item.date}</span>
                    <span>{a('submittedBy')}: {item.submitter}</span>
                    {'distance' in item && <span>{fmtMi(item.distance)}</span>}
                  </div>
                  {item.reviewer_notes && (
                    <p className="text-xs text-gray-400 mt-1 italic">{item.reviewer_notes}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-lg">{fmt$(item.amount)}</div>

                  {reviewingId === item.id ? (
                    <div className="flex flex-col gap-1 w-48 mt-2">
                      <Input
                        value={reviewNotes}
                        onChange={e => setReviewNotes(e.target.value)}
                        placeholder={a('notesPlaceholder')}
                      />
                      <div className="flex gap-1">
                        <Button size="sm" onClick={() => handleApprove(item, reviewNotes || undefined)}>{a('approve')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => handleReject(item, reviewNotes || undefined)}>{a('reject')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setReviewingId(null)}>✕</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-1 mt-2 flex-wrap justify-end">
                      <Button size="sm" onClick={() => { setReviewingId(item.id); setReviewNotes('') }}>Review</Button>
                      {item.kind === 'expense' && (
                        <Button size="sm" variant="ghost" onClick={() => handleFlag(item)}>{a('needsReview')}</Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
