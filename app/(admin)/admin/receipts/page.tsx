'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import {
  getExpenses,
  approveExpense,
  rejectExpense,
  markExpensePaid,
} from '@/app/actions/expenseActions'

interface Expense {
  id: string
  description: string
  amount: number
  expense_date: string
  expense_type: 'company' | 'reimbursement'
  approval_status: string
  category: { id: string; name: string; color: string | null } | null
  project: { id: string; name: string } | null
  submitted_by: { id: string; full_name: string } | null
  receipt: { id: string; file_url: string; merchant_name: string | null; last_four_digits: string | null } | null
  reviewer_notes: string | null
  created_at: string
}

type Tab = 'pending' | 'approved' | 'paid' | 'all'

const fmt$ = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function statusBadge(status: string) {
  if (status === 'paid') return <Badge variant="green">Paid</Badge>
  if (status === 'approved') return <Badge variant="green">Approved</Badge>
  if (status === 'rejected') return <Badge variant="red">Rejected</Badge>
  if (status === 'needs_review') return <Badge variant="amber">Needs Review</Badge>
  if (status === 'submitted') return <Badge variant="blue">Submitted</Badge>
  return <Badge variant="default">Draft</Badge>
}

export default function AdminReceiptsPage() {
  const [tab, setTab] = useState<Tab>('pending')
  const [search, setSearch] = useState('')
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const filter = tab === 'pending' ? 'pending' : tab === 'approved' ? 'approved' : undefined
    const res = await getExpenses(filter)
    if (res.ok) setExpenses((res.expenses ?? []) as unknown as Expense[])
    setLoading(false)
  }, [tab])

  useEffect(() => { load() }, [load])

  const filtered = expenses.filter(exp => {
    if (tab === 'paid') return exp.approval_status === 'paid'
    if (tab === 'approved') return exp.approval_status === 'approved'
    if (tab === 'pending') return ['submitted', 'needs_review'].includes(exp.approval_status)
    // 'all' — exclude draft
    return exp.approval_status !== 'draft'
  }).filter(exp => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      exp.description.toLowerCase().includes(q) ||
      (exp.submitted_by?.full_name ?? '').toLowerCase().includes(q) ||
      (exp.project?.name ?? '').toLowerCase().includes(q) ||
      (exp.receipt?.merchant_name ?? '').toLowerCase().includes(q)
    )
  })

  async function handleApprove(id: string) {
    await approveExpense(id, reviewNotes || undefined)
    setReviewingId(null)
    setReviewNotes('')
    load()
  }

  async function handleReject(id: string) {
    await rejectExpense(id, reviewNotes || undefined)
    setReviewingId(null)
    setReviewNotes('')
    load()
  }

  async function handleMarkPaid(id: string) {
    await markExpensePaid(id)
    load()
  }

  const pendingTotal = expenses
    .filter(e => ['submitted', 'needs_review'].includes(e.approval_status))
    .reduce((s, e) => s + e.amount, 0)
  const approvedTotal = expenses
    .filter(e => e.approval_status === 'approved')
    .reduce((s, e) => s + e.amount, 0)

  const TABS: { key: Tab; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'approved', label: 'Approved' },
    { key: 'paid', label: 'Paid' },
    { key: 'all', label: 'All' },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4 pb-24">
      <div>
        <h1 className="text-2xl font-bold">Receipts</h1>
        <p className="text-sm text-gray-500 mt-0.5">Review and approve employee expense receipts</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3 text-center">
          <div className="text-xs text-gray-500">Awaiting Review</div>
          <div className="text-xl font-bold mt-1 text-amber">{fmt$(pendingTotal)}</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-xs text-gray-500">Approved (unpaid)</div>
          <div className="text-xl font-bold mt-1 text-green">{fmt$(approvedTotal)}</div>
        </Card>
      </div>

      {/* Search */}
      <Input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by employee, merchant, project…"
      />

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">No receipts found</p>
      ) : (
        <div className="space-y-3">
          {filtered.map(exp => (
            <Card key={exp.id} className="p-4">
              <div className="flex items-start gap-3">
                {/* Receipt thumbnail */}
                {exp.receipt?.file_url && (
                  <button
                    onClick={() => setPreviewUrl(exp.receipt!.file_url)}
                    className="shrink-0 w-14 h-16 rounded-lg overflow-hidden border border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={exp.receipt.file_url} alt="Receipt" className="w-full h-full object-cover" />
                  </button>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{exp.description}</span>
                    {statusBadge(exp.approval_status)}
                  </div>
                  <div className="text-sm text-gray-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span>{exp.expense_date}</span>
                    {exp.submitted_by && <span>{exp.submitted_by.full_name}</span>}
                    {exp.project && <span>{exp.project.name}</span>}
                    {exp.category && <span>{exp.category.name}</span>}
                  </div>
                  {exp.reviewer_notes && (
                    <p className="text-xs text-gray-400 mt-1 italic">{exp.reviewer_notes}</p>
                  )}

                  {/* Review actions */}
                  {['submitted', 'needs_review'].includes(exp.approval_status) && (
                    <div className="mt-2">
                      {reviewingId === exp.id ? (
                        <div className="flex flex-col gap-1.5">
                          <Input
                            value={reviewNotes}
                            onChange={e => setReviewNotes(e.target.value)}
                            placeholder="Optional notes…"
                          />
                          <div className="flex gap-1.5">
                            <Button size="sm" onClick={() => handleApprove(exp.id)}>Approve</Button>
                            <Button size="sm" variant="ghost" onClick={() => handleReject(exp.id)}>Reject</Button>
                            <Button size="sm" variant="ghost" onClick={() => setReviewingId(null)}>Cancel</Button>
                          </div>
                        </div>
                      ) : (
                        <Button size="sm" onClick={() => { setReviewingId(exp.id); setReviewNotes('') }}>Review</Button>
                      )}
                    </div>
                  )}

                  {/* Mark paid */}
                  {exp.approval_status === 'approved' && (
                    <div className="mt-2">
                      <Button size="sm" onClick={() => handleMarkPaid(exp.id)}>Mark as Paid</Button>
                    </div>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <div className="font-bold text-lg">{fmt$(exp.amount)}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {exp.expense_type === 'company' ? 'Company' : 'Reimburse'}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Image preview modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Receipt"
            className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setPreviewUrl(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white text-2xl font-light"
          >✕</button>
        </div>
      )}
    </div>
  )
}
