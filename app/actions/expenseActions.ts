'use server'

import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { hasPermission, type EmployeePermissions } from '@/lib/permissions'
import { revalidatePath } from 'next/cache'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getCallerProfile(supabase: ReturnType<typeof createClient>, email: string, company_id: string) {
  const { data } = await supabase
    .from('profiles')
    .select('id, permissions')
    .eq('email', email)
    .eq('company_id', company_id)
    .maybeSingle()
  return data
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function getExpenseCategories() {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()
  const { data, error } = await supabase
    .from('expense_categories')
    .select('id, name, color')
    .eq('company_id', user.company_id)
    .order('name')

  if (error) return { error: error.message }
  return { ok: true, categories: data ?? [] }
}

// ─── Receipts ─────────────────────────────────────────────────────────────────

// Persists the scanned receipt photo + AI-extracted fields as its own
// record, so it survives after the expense is filed (previously the photo
// was discarded right after the scan — only the text fields made it into
// the expense form).
export async function createReceipt(data: {
  file_path: string
  file_url: string
  merchant_name?: string | null
  transaction_date?: string | null
  total_amount?: number | null
  last_four_digits?: string | null
  ai_confidence?: number | null
}) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()
  const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
  if (!profile) return { error: 'Profile not found' }

  if (user.role === 'employee') {
    const canUpload = hasPermission(profile.permissions as EmployeePermissions | null, 'upload_receipts')
    if (!canUpload) return { error: 'Not authorized' }
  }

  const { data: receipt, error } = await supabase
    .from('receipts')
    .insert({
      company_id: user.company_id,
      uploaded_by: profile.id,
      file_path: data.file_path,
      file_url: data.file_url,
      merchant_name: data.merchant_name ?? null,
      transaction_date: data.transaction_date ?? null,
      total_amount: data.total_amount ?? null,
      last_four_digits: data.last_four_digits ?? null,
      ai_confidence: data.ai_confidence ?? null,
      status: 'confirmed',
    })
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  return { ok: true, id: receipt?.id }
}

// ─── Expenses ─────────────────────────────────────────────────────────────────

export async function getExpenses(filter?: 'all' | 'pending' | 'approved' | 'rejected') {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  let query = supabase
    .from('expenses')
    .select(`
      id, description, amount, expense_date, expense_type, approval_status,
      category:category_id(id, name, color),
      project:project_id(id, name),
      submitted_by:submitted_by_profile_id(id, full_name),
      receipt:receipt_id(id, file_url, merchant_name, last_four_digits),
      reviewer_notes, created_at
    `)
    .eq('company_id', user.company_id)
    .order('expense_date', { ascending: false })

  // Employees can only see their own expenses
  if (user.role === 'employee') {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    const canUpload = hasPermission(profile.permissions as EmployeePermissions | null, 'upload_receipts')
    if (!canUpload) return { error: 'Not authorized' }
    query = query.eq('submitted_by_profile_id', profile.id)
  }

  if (filter === 'pending') {
    query = query.in('approval_status', ['submitted', 'needs_review'])
  } else if (filter === 'approved') {
    query = query.eq('approval_status', 'approved')
  } else if (filter === 'rejected') {
    query = query.eq('approval_status', 'rejected')
  }

  const { data, error } = await query
  if (error) return { error: error.message }
  return { ok: true, expenses: data ?? [] }
}

export async function createExpense(data: {
  description: string
  amount: number
  expense_date: string
  expense_type: 'company' | 'reimbursement'
  category_id?: string
  project_id?: string
  receipt_id?: string
}) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  let profile_id: string
  if (user.role === 'admin') {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    profile_id = profile.id
  } else {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    const canUpload = hasPermission(profile.permissions as EmployeePermissions | null, 'upload_receipts')
    if (!canUpload) return { error: 'Not authorized' }
    profile_id = profile.id
  }

  const { data: expense, error } = await supabase
    .from('expenses')
    .insert({
      company_id: user.company_id,
      submitted_by: profile_id,
      submitted_by_profile_id: profile_id,
      description: data.description.trim(),
      amount: data.amount,
      expense_date: data.expense_date,
      expense_type: data.expense_type,
      category_id: data.category_id ?? null,
      project_id: data.project_id ?? null,
      receipt_id: data.receipt_id ?? null,
      approval_status: 'draft',
    })
    .select('id')
    .maybeSingle()

  if (error) return { error: error.message }
  revalidatePath('/admin/expenses')
  revalidatePath('/expenses')
  return { ok: true, id: expense?.id }
}

export async function submitExpense(expenseId: string) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  let baseQuery = supabase
    .from('expenses')
    .update({ approval_status: 'submitted' })
    .eq('id', expenseId)
    .eq('company_id', user.company_id)
    .eq('approval_status', 'draft')

  // Employees can only submit their own
  if (user.role === 'employee') {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    const canUpload = hasPermission(profile.permissions as EmployeePermissions | null, 'upload_receipts')
    if (!canUpload) return { error: 'Not authorized' }
    baseQuery = baseQuery.eq('submitted_by_profile_id', profile.id)
  }

  const { error } = await baseQuery
  if (error) return { error: error.message }
  revalidatePath('/admin/expenses')
  revalidatePath('/expenses')
  return { ok: true }
}

export async function approveExpense(expenseId: string, notes?: string) {
  const user = getCurrentUser()
  // Only admins can approve
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()
  const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
  if (!profile) return { error: 'Profile not found' }

  const { error } = await supabase
    .from('expenses')
    .update({
      approval_status: 'approved',
      reviewed_by_profile_id: profile.id,
      reviewer_notes: notes?.trim() || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', expenseId)
    .eq('company_id', user.company_id)

  if (error) return { error: error.message }
  revalidatePath('/admin/expenses')
  revalidatePath('/admin/approvals')
  return { ok: true }
}

export async function rejectExpense(expenseId: string, notes?: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()
  const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
  if (!profile) return { error: 'Profile not found' }

  const { error } = await supabase
    .from('expenses')
    .update({
      approval_status: 'rejected',
      reviewed_by_profile_id: profile.id,
      reviewer_notes: notes?.trim() || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', expenseId)
    .eq('company_id', user.company_id)

  if (error) return { error: error.message }
  revalidatePath('/admin/expenses')
  revalidatePath('/admin/approvals')
  return { ok: true }
}

export async function flagExpenseForReview(expenseId: string, notes?: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()
  const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
  if (!profile) return { error: 'Profile not found' }

  const { error } = await supabase
    .from('expenses')
    .update({
      approval_status: 'needs_review',
      reviewed_by_profile_id: profile.id,
      reviewer_notes: notes?.trim() || null,
    })
    .eq('id', expenseId)
    .eq('company_id', user.company_id)

  if (error) return { error: error.message }
  revalidatePath('/admin/expenses')
  revalidatePath('/admin/approvals')
  return { ok: true }
}

export async function updateExpense(
  expenseId: string,
  data: {
    description?: string
    amount?: number
    expense_date?: string
    expense_type?: 'company' | 'reimbursement'
    category_id?: string | null
    project_id?: string | null
    receipt_id?: string | null
  }
) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  const payload: Record<string, unknown> = {}
  if (data.description !== undefined) payload.description = data.description.trim()
  if (data.amount !== undefined) payload.amount = data.amount
  if (data.expense_date !== undefined) payload.expense_date = data.expense_date
  if (data.expense_type !== undefined) payload.expense_type = data.expense_type
  if (data.category_id !== undefined) payload.category_id = data.category_id
  if (data.project_id !== undefined) payload.project_id = data.project_id
  if (data.receipt_id !== undefined) payload.receipt_id = data.receipt_id

  let query = supabase
    .from('expenses')
    .update(payload)
    .eq('id', expenseId)
    .eq('company_id', user.company_id)
    .in('approval_status', ['draft', 'needs_review'])

  if (user.role === 'employee') {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    const canUpload = hasPermission(profile.permissions as EmployeePermissions | null, 'upload_receipts')
    if (!canUpload) return { error: 'Not authorized' }
    query = query.eq('submitted_by_profile_id', profile.id)
  }

  const { error } = await query
  if (error) return { error: error.message }
  revalidatePath('/admin/expenses')
  revalidatePath('/expenses')
  return { ok: true }
}

export async function deleteExpense(expenseId: string) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  let query = supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId)
    .eq('company_id', user.company_id)
    .eq('approval_status', 'draft')

  if (user.role === 'employee') {
    const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
    if (!profile) return { error: 'Profile not found' }
    query = query.eq('submitted_by_profile_id', profile.id)
  }

  const { error } = await query
  if (error) return { error: error.message }
  revalidatePath('/admin/expenses')
  revalidatePath('/expenses')
  return { ok: true }
}

// Admin-only: delete an expense in any status (a draft, a rejected one, or
// one entered by mistake). Scoped to the admin's own company.
export async function adminDeleteExpense(expenseId: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()
  const { data, error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', expenseId)
    .eq('company_id', user.company_id)
    .select('id')

  if (error) return { error: 'Could not delete this expense. Please try again.' }
  if (!data || data.length === 0) return { error: 'Expense not found.' }
  revalidatePath('/admin/expenses')
  revalidatePath('/admin/reports')
  revalidatePath('/expenses')
  return { ok: true }
}

export async function markExpensePaid(expenseId: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()
  const profile = await getCallerProfile(supabase, user.email!, user.company_id!)
  if (!profile) return { error: 'Profile not found' }

  const { error } = await supabase
    .from('expenses')
    .update({
      approval_status: 'paid',
      paid_at: new Date().toISOString(),
      paid_by: profile.id,
    })
    .eq('id', expenseId)
    .eq('company_id', user.company_id)
    .eq('approval_status', 'approved')

  if (error) return { error: error.message }
  revalidatePath('/admin/expenses')
  revalidatePath('/admin/receipts')
  revalidatePath('/expenses')
  return { ok: true }
}

// ─── Pending approvals count (for dashboard badge) ────────────────────────────

export async function getPendingApprovalsCount() {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { count: 0 }

  const supabase = createClient()

  const [{ count: expCount }, { count: mileCount }] = await Promise.all([
    supabase
      .from('expenses')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', user.company_id)
      .in('approval_status', ['submitted', 'needs_review']),
    supabase
      .from('mileage_trips')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', user.company_id)
      .in('approval_status', ['submitted', 'needs_review']),
  ])

  return { count: (expCount ?? 0) + (mileCount ?? 0) }
}
