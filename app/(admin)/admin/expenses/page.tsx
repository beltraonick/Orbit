'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import {
  getExpenses,
  getExpenseCategories,
  createExpense,
  updateExpense,
  deleteExpense,
  submitExpense,
  approveExpense,
  rejectExpense,
} from '@/app/actions/expenseActions'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Category { id: string; name: string; color: string | null }
interface Project { id: string; name: string }
interface Expense {
  id: string
  description: string
  amount: number
  expense_date: string
  expense_type: 'company' | 'reimbursement'
  approval_status: string
  category: Category | null
  project: { id: string; name: string } | null
  submitted_by: { id: string; full_name: string } | null
  receipt: { id: string; file_url: string } | null
  reviewer_notes: string | null
  created_at: string
}

type Filter = 'all' | 'pending' | 'approved' | 'rejected'

const BLANK_FORM = {
  description: '',
  amount: '',
  expense_date: new Date().toISOString().slice(0, 10),
  expense_type: 'reimbursement' as 'company' | 'reimbursement',
  category_id: '',
  project_id: '',
}

const fmt$ = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function statusBadge(status: string) {
  if (status === 'approved') return <Badge variant="green">Approved</Badge>
  if (status === 'rejected') return <Badge variant="red">Rejected</Badge>
  if (status === 'needs_review') return <Badge variant="amber">Needs Review</Badge>
  if (status === 'submitted') return <Badge variant="blue">Submitted</Badge>
  return <Badge variant="default">Draft</Badge>
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const e = (k: string) => t(`admin.expenses.${k}`)

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewNotes, setReviewNotes] = useState('')
  const [form, setForm] = useState({ ...BLANK_FORM })
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getExpenses(filter === 'all' ? undefined : filter)
    if (res.ok) setExpenses((res.expenses ?? []) as unknown as Expense[])
    setLoading(false)
  }, [filter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    getExpenseCategories().then(r => { if (r.ok) setCategories((r.categories ?? []) as Category[]) })

    if (!companyId) return
    createClient()
      .from('projects')
      .select('id, name')
      .eq('company_id', companyId)
      .order('name')
      .then(({ data }) => setProjects(data ?? []))
  }, [companyId])

  function openAdd() {
    setEditing(null)
    setForm({ ...BLANK_FORM })
    setErr('')
    setShowModal(true)
  }

  function openEdit(exp: Expense) {
    setEditing(exp)
    setForm({
      description: exp.description,
      amount: String(exp.amount),
      expense_date: exp.expense_date,
      expense_type: exp.expense_type,
      category_id: exp.category?.id ?? '',
      project_id: exp.project?.id ?? '',
    })
    setErr('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.description.trim()) return setErr('Description required')
    const amt = parseFloat(form.amount)
    if (!amt || amt <= 0) return setErr('Valid amount required')

    setSaving(true)
    setErr('')
    const payload = {
      description: form.description,
      amount: amt,
      expense_date: form.expense_date,
      expense_type: form.expense_type,
      category_id: form.category_id || undefined,
      project_id: form.project_id || undefined,
    }

    const res = editing
      ? await updateExpense(editing.id, payload)
      : await createExpense(payload)

    if (res.error) { setErr(res.error); setSaving(false); return }
    setSaving(false)
    setShowModal(false)
    load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this expense?')) return
    await deleteExpense(id)
    load()
  }

  async function handleSubmit(id: string) {
    await submitExpense(id)
    load()
  }

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

  // ─── Summary stats ─────────────────────────────────────────────────────────
  const total = expenses.reduce((s, e) => s + e.amount, 0)
  const pending = expenses.filter(e => ['submitted', 'needs_review'].includes(e.approval_status)).reduce((s, e) => s + e.amount, 0)
  const approved = expenses.filter(e => e.approval_status === 'approved').reduce((s, e) => s + e.amount, 0)

  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: e('filterAll') },
    { key: 'pending', label: e('filterPending') },
    { key: 'approved', label: e('filterApproved') },
    { key: 'rejected', label: e('filterRejected') },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{e('title')}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{e('subtitle')}</p>
        </div>
        <Button onClick={openAdd}>{e('addExpense')}</Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3 text-center">
          <div className="text-xs text-gray-500">{e('summaryTotal')}</div>
          <div className="text-lg font-bold mt-1">{fmt$(total)}</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-xs text-gray-500">{e('summaryPending')}</div>
          <div className="text-lg font-bold mt-1 text-amber-600">{fmt$(pending)}</div>
        </Card>
        <Card className="p-3 text-center">
          <div className="text-xs text-gray-500">{e('summaryApproved')}</div>
          <div className="text-lg font-bold mt-1 text-green-600">{fmt$(approved)}</div>
        </Card>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {filters.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.key
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>
      ) : expenses.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">{filter === 'all' ? e('noExpenses') : e('noExpensesFiltered')}</p>
      ) : (
        <div className="space-y-3">
          {expenses.map(exp => (
            <Card key={exp.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{exp.description}</span>
                    {statusBadge(exp.approval_status)}
                    <Badge variant="default">{exp.expense_type === 'company' ? e('typeCompany') : e('typeReimbursement')}</Badge>
                  </div>
                  <div className="text-sm text-gray-500 mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                    <span>{e('date')}: {exp.expense_date}</span>
                    {exp.submitted_by && <span>{e('submittedBy')}: {exp.submitted_by.full_name}</span>}
                    {exp.category && <span>{exp.category.name}</span>}
                    {exp.project && <span>{exp.project.name}</span>}
                  </div>
                  {exp.reviewer_notes && (
                    <p className="text-xs text-gray-400 mt-1 italic">{exp.reviewer_notes}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-lg">{fmt$(exp.amount)}</div>
                  <div className="flex gap-1 mt-2 flex-wrap justify-end">
                    {exp.approval_status === 'draft' && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(exp)}>{e('editExpense')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => handleSubmit(exp.id)}>{e('submitForReview')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(exp.id)}>✕</Button>
                      </>
                    )}
                    {['submitted', 'needs_review'].includes(exp.approval_status) && (
                      <>
                        {reviewingId === exp.id ? (
                          <div className="flex flex-col gap-1 w-48">
                            <Input
                              value={reviewNotes}
                              onChange={e => setReviewNotes(e.target.value)}
                              placeholder={e('notesPlaceholder')}
                            />
                            <div className="flex gap-1">
                              <Button size="sm" onClick={() => handleApprove(exp.id)}>{e('approve')}</Button>
                              <Button size="sm" variant="ghost" onClick={() => handleReject(exp.id)}>{e('reject')}</Button>
                              <Button size="sm" variant="ghost" onClick={() => setReviewingId(null)}>✕</Button>
                            </div>
                          </div>
                        ) : (
                          <Button size="sm" onClick={() => { setReviewingId(exp.id); setReviewNotes('') }}>Review</Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-4">
          <Card className="w-full max-w-md p-5 space-y-4">
            <h2 className="font-semibold text-lg">{editing ? e('editExpense') : e('addExpenseTitle')}</h2>

            <Input
              label={e('description')}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder={e('descriptionPlaceholder')}
            />
            <Input
              label={e('amount')}
              type="number"
              value={form.amount}
              onChange={ev => setForm(f => ({ ...f, amount: ev.target.value }))}
              placeholder="0.00"
            />
            <Input
              label={e('date')}
              type="date"
              value={form.expense_date}
              onChange={ev => setForm(f => ({ ...f, expense_date: ev.target.value }))}
            />

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{e('expenseType')}</label>
              <div className="flex gap-3">
                {(['reimbursement', 'company'] as const).map(type => (
                  <label key={type} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      checked={form.expense_type === type}
                      onChange={() => setForm(f => ({ ...f, expense_type: type }))}
                    />
                    <span className="text-sm">{type === 'company' ? e('typeCompany') : e('typeReimbursement')}</span>
                  </label>
                ))}
              </div>
            </div>

            {categories.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{e('category')}</label>
                <select
                  value={form.category_id}
                  onChange={ev => setForm(f => ({ ...f, category_id: ev.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800"
                >
                  <option value="">— Select —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            {projects.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{e('project')}</label>
                <select
                  value={form.project_id}
                  onChange={ev => setForm(f => ({ ...f, project_id: ev.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800"
                >
                  <option value="">— None —</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            )}

            {err && <p className="text-red-500 text-sm">{err}</p>}

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? 'Saving…' : editing ? t('common.saveChanges') : e('saveDraft')}
              </Button>
              <Button variant="ghost" onClick={() => setShowModal(false)} className="flex-1">{t('common.cancel')}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
