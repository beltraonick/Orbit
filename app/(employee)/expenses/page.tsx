'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { usePermissions } from '@/lib/permissions-context'
import { hasPermission } from '@/lib/permissions'
import {
  getExpenses,
  getExpenseCategories,
  createExpense,
  updateExpense,
  deleteExpense,
  submitExpense,
} from '@/app/actions/expenseActions'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'

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
  reviewer_notes: string | null
  created_at: string
}

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

export default function EmployeeExpensesPage() {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const permissions = usePermissions()
  const e = (k: string) => t(`admin.expenses.${k}`)

  const canUpload = hasPermission(permissions, 'upload_receipts')

  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [form, setForm] = useState({ ...BLANK_FORM })
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getExpenses()
    if (res.ok) setExpenses((res.expenses ?? []) as Expense[])
    setLoading(false)
  }, [])

  useEffect(() => { if (canUpload) load() }, [load, canUpload])

  useEffect(() => {
    if (!canUpload) return
    getExpenseCategories().then(r => { if (r.ok) setCategories((r.categories ?? []) as Category[]) })
    if (!companyId) return
    createClient()
      .from('projects')
      .select('id, name')
      .eq('company_id', companyId)
      .order('name')
      .then(({ data }) => setProjects(data ?? []))
  }, [companyId, canUpload])

  if (!canUpload) {
    return (
      <div className="p-4 pt-20 pb-28 flex flex-col items-center justify-center min-h-screen gap-3">
        <p className="text-gray-400 text-center">{t('admin.employees.permissionDesc_upload_receipts')}</p>
        <p className="text-xs text-gray-400 text-center">You do not have permission to submit expenses. Contact your admin.</p>
      </div>
    )
  }

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

  async function handleSubmit(id: string) {
    await submitExpense(id)
    load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this expense?')) return
    await deleteExpense(id)
    load()
  }

  const pending = expenses.filter(e => ['draft', 'submitted', 'needs_review'].includes(e.approval_status))
  const history = expenses.filter(e => ['approved', 'rejected'].includes(e.approval_status))

  return (
    <div className="p-4 pt-20 pb-28 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{e('title')}</h1>
          <p className="text-sm text-gray-500">{e('subtitle')}</p>
        </div>
        <Button onClick={openAdd}>{e('addExpense')}</Button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-8 text-center">Loading…</p>
      ) : expenses.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">{e('noExpenses')}</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{e('filterPending')}</h2>
              {pending.map(exp => (
                <Card key={exp.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{exp.description}</span>
                        {statusBadge(exp.approval_status)}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{exp.expense_date}{exp.category ? ` · ${exp.category.name}` : ''}</p>
                      {exp.reviewer_notes && <p className="text-xs text-gray-400 mt-1 italic">{exp.reviewer_notes}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold">{fmt$(exp.amount)}</div>
                      {exp.approval_status === 'draft' && (
                        <div className="flex gap-1 mt-2">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(exp)}>{e('editExpense')}</Button>
                          <Button size="sm" variant="ghost" onClick={() => handleSubmit(exp.id)}>{e('submitForReview')}</Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(exp.id)}>✕</Button>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">History</h2>
              {history.map(exp => (
                <Card key={exp.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{exp.description}</span>
                        {statusBadge(exp.approval_status)}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">{exp.expense_date}</p>
                    </div>
                    <div className="font-bold shrink-0">{fmt$(exp.amount)}</div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end justify-center p-4">
          <Card className="w-full max-w-md p-5 space-y-4">
            <h2 className="font-semibold text-lg">{editing ? e('editExpense') : e('addExpenseTitle')}</h2>

            <Input label={e('description')} value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder={e('descriptionPlaceholder')} />
            <Input label={e('amount')} type="number" value={form.amount} onChange={v => setForm(f => ({ ...f, amount: v }))} placeholder="0.00" />
            <Input label={e('date')} type="date" value={form.expense_date} onChange={v => setForm(f => ({ ...f, expense_date: v }))} />

            {categories.length > 0 && (
              <div className="space-y-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{e('category')}</label>
                <select value={form.category_id} onChange={ev => setForm(f => ({ ...f, category_id: ev.target.value }))}
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800">
                  <option value="">— Select —</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}

            {err && <p className="text-red-500 text-sm">{err}</p>}

            <div className="flex gap-2 pt-1">
              <Button onClick={handleSave} disabled={saving} className="flex-1">{saving ? 'Saving…' : e('saveDraft')}</Button>
              <Button variant="ghost" onClick={() => setShowModal(false)} className="flex-1">{t('common.cancel')}</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
