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
  createReceipt,
} from '@/app/actions/expenseActions'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { ReceiptScanner } from '@/components/ReceiptScanner'

const RECEIPT_BUCKET = 'receipts'

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
  receipt: { id: string; file_url: string; merchant_name: string | null; last_four_digits: string | null } | null
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
  notes: '',
}

const fmt$ = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function statusBadge(status: string) {
  if (status === 'approved') return <Badge variant="green">Approved</Badge>
  if (status === 'paid') return <Badge variant="green">Paid</Badge>
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
  const [uploading, setUploading] = useState(false)
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null)
  const [showScanner, setShowScanner] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getExpenses()
    if (res.ok) setExpenses((res.expenses ?? []) as unknown as Expense[])
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
      <div className="p-4 flex flex-col items-center justify-center min-h-screen gap-3">
        <p className="text-gray-400 text-center">You do not have permission to submit expenses. Contact your admin.</p>
      </div>
    )
  }

  function openAdd() {
    setEditing(null)
    setForm({ ...BLANK_FORM })
    setErr('')
    setReceiptId(null)
    setReceiptPreviewUrl(null)
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
      notes: '',
    })
    setErr('')
    setReceiptId(exp.receipt?.id ?? null)
    setReceiptPreviewUrl(exp.receipt?.file_url ?? null)
    setShowModal(true)
  }

  async function handleSave() {
    const amt = parseFloat(form.amount)
    if (!amt || amt <= 0) return setErr('Enter a valid amount')

    setSaving(true)
    setErr('')
    const payload = {
      description: form.description.trim() || (form.notes.trim() || 'Expense'),
      amount: amt,
      expense_date: form.expense_date,
      expense_type: form.expense_type,
      category_id: form.category_id || undefined,
      project_id: form.project_id || undefined,
      receipt_id: receiptId ?? undefined,
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

  async function handleScanCapture(base64: string, mediaType: string) {
    setShowScanner(false)
    setUploading(true)
    setErr('')
    setReceiptId(null)
    setReceiptPreviewUrl(null)

    try {
      if (companyId) {
        const bytes = atob(base64)
        const ab = new ArrayBuffer(bytes.length)
        const ia = new Uint8Array(ab)
        for (let i = 0; i < bytes.length; i++) ia[i] = bytes.charCodeAt(i)
        const blob = new Blob([ab], { type: mediaType })
        const path = `${companyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
        const supabase = createClient()
        const { error: uploadErr } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, blob)
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from(RECEIPT_BUCKET).getPublicUrl(path)
          const receiptRes = await createReceipt({
            file_path: path,
            file_url: urlData.publicUrl,
          })
          if (receiptRes.ok && receiptRes.id) {
            setReceiptId(receiptRes.id)
            setReceiptPreviewUrl(urlData.publicUrl)
          }
        }
      }
    } catch {
      // Photo still usable even if upload fails — just no stored receipt
    } finally {
      setUploading(false)
    }

    // Open the form with today's date pre-filled
    setEditing(null)
    setForm({ ...BLANK_FORM })
    setErr('')
    setShowModal(true)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this expense?')) return
    await deleteExpense(id)
    load()
  }

  const pending = expenses.filter(e => ['draft', 'submitted', 'needs_review'].includes(e.approval_status))
  const history = expenses.filter(e => ['approved', 'rejected', 'paid'].includes(e.approval_status))

  return (
    <div className="p-4 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{e('title')}</h1>
          <p className="text-sm text-gray-500">{e('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={() => setShowScanner(true)}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-sm font-semibold transition-all border active:scale-[.98]"
            style={uploading
              ? { backgroundColor: '#f3f4f6', color: '#9ca3af', borderColor: '#e5e7eb', cursor: 'not-allowed' }
              : { backgroundColor: '#3b82f6', color: '#ffffff', borderColor: '#3b82f6', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.12)' }
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            {uploading ? 'Uploading…' : 'Scan'}
          </button>
          <Button onClick={openAdd}>{e('addExpense')}</Button>
        </div>
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
                      {exp.receipt?.file_url && (
                        <a
                          href={exp.receipt.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue hover:opacity-80 mt-1 inline-block"
                        >
                          View receipt
                        </a>
                      )}
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

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-3 sm:p-6">
          <Card padding="none" className="w-full max-w-md overflow-hidden max-h-[92vh] rounded-3xl flex flex-col">
            <div className="flex items-center justify-between px-5 pt-5 pb-1">
              <h2 className="font-semibold text-[17px] tracking-tight">{editing ? e('editExpense') : e('addExpenseTitle')}</h2>
              <button
                onClick={() => setShowModal(false)}
                className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm"
              >✕</button>
            </div>

            <div className="px-5 pb-5 space-y-3 mt-3 overflow-y-auto">
              {/* Receipt preview */}
              {receiptPreviewUrl && (
                <div className="rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={receiptPreviewUrl} alt="Receipt" className="w-full object-cover max-h-40" />
                </div>
              )}
              {!receiptPreviewUrl && !editing && (
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setShowScanner(true) }}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 text-sm text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                  Attach a receipt photo
                </button>
              )}

              <Input
                label="Merchant / Store"
                value={form.description}
                onChange={ev => setForm(f => ({ ...f, description: ev.target.value }))}
                placeholder="e.g. Home Depot"
              />

              <Input
                label={`${e('amount')} *`}
                type="number"
                value={form.amount}
                onChange={ev => setForm(f => ({ ...f, amount: ev.target.value }))}
                placeholder="0.00"
              />

              <Input
                label={`${e('date')} *`}
                type="date"
                value={form.expense_date}
                onChange={ev => setForm(f => ({ ...f, expense_date: ev.target.value }))}
              />

              {categories.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{e('category')}</label>
                  <select
                    value={form.category_id}
                    onChange={ev => setForm(f => ({ ...f, category_id: ev.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  >
                    <option value="">— Select —</option>
                    {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              {projects.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Project</label>
                  <select
                    value={form.project_id}
                    onChange={ev => setForm(f => ({ ...f, project_id: ev.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  >
                    <option value="">— None —</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={ev => setForm(f => ({ ...f, notes: ev.target.value }))}
                  placeholder="Optional note…"
                  rows={2}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none"
                />
              </div>

              {err && <p className="text-red-500 text-sm">{err}</p>}

              <div className="flex gap-2 pt-1">
                <Button onClick={handleSave} disabled={saving} className="flex-1">{saving ? 'Saving…' : e('saveDraft')}</Button>
                <Button variant="ghost" onClick={() => setShowModal(false)} className="flex-1">{t('common.cancel')}</Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {showScanner && (
        <ReceiptScanner
          onCapture={handleScanCapture}
          onClose={() => setShowScanner(false)}
        />
      )}
    </div>
  )
}
