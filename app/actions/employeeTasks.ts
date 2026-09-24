'use server'

import { notifyProfiles, companyAdminIds } from '@/lib/push'
import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function updateEmployeeTask(
  taskId: string,
  updates: {
    status?: string
    checklist?: { text: string; done: boolean }[]
    title?: string
    notes?: string
  }
) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('email', user.email)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!profile) return { error: 'Profile not found' }

  // Verify this employee is assigned to the task
  const { data: assignment } = await supabase
    .from('task_assignments')
    .select('task_id')
    .eq('task_id', taskId)
    .eq('profile_id', profile.id)
    .maybeSingle()

  if (!assignment) return { error: 'Not assigned to this task' }

  // Fetch current task state for audit diff
  const { data: currentTask } = await supabase
    .from('tasks')
    .select('id, title, status, checklist, notes, project_id')
    .eq('id', taskId)
    .maybeSingle()

  if (!currentTask) return { error: 'Task not found' }

  const changes: { field: string; old_value: unknown; new_value: unknown }[] = []
  const payload: Record<string, unknown> = {}

  if (updates.status !== undefined && updates.status !== currentTask.status) {
    changes.push({ field: 'status', old_value: currentTask.status, new_value: updates.status })
    payload.status = updates.status
  }

  if (updates.checklist !== undefined) {
    const oldJson = JSON.stringify(currentTask.checklist ?? [])
    const newJson = JSON.stringify(updates.checklist)
    if (oldJson !== newJson) {
      changes.push({ field: 'checklist', old_value: currentTask.checklist ?? [], new_value: updates.checklist })
      payload.checklist = updates.checklist
    }
  }

  if (updates.title !== undefined && updates.title.trim() !== '' && updates.title !== currentTask.title) {
    changes.push({ field: 'title', old_value: currentTask.title, new_value: updates.title })
    payload.title = updates.title
  }

  const currentNotes = (currentTask as Record<string, unknown>).notes as string ?? ''
  if (updates.notes !== undefined && updates.notes !== currentNotes) {
    changes.push({ field: 'notes', old_value: currentNotes, new_value: updates.notes })
    payload.notes = updates.notes
  }

  if (changes.length === 0) return { ok: true }

  const { error: updateErr } = await supabase
    .from('tasks')
    .update(payload)
    .eq('id', taskId)

  if (updateErr) return { error: updateErr.message }

  // Write audit log
  await supabase.from('task_audit_log').insert({
    task_id: taskId,
    project_id: currentTask.project_id,
    company_id: user.company_id,
    changed_by_profile_id: profile.id,
    changed_by_name: profile.full_name,
    task_title: currentTask.title,
    changes,
  })

  if (payload.status === 'completed' && user.company_id) {
    await notifyProfiles(await companyAdminIds(user.company_id), 'tasks', {
      title: 'Task completed ✅',
      body: `${profile.full_name} completed "${currentTask.title}"`,
      url: `/admin/projects/${currentTask.project_id}`,
    })
  }

  revalidatePath(`/projects/${currentTask.project_id}`)
  revalidatePath(`/admin/projects/${currentTask.project_id}`)
  return { ok: true }
}

export async function createSupervisorTask(
  projectId: string,
  columnId: string | null,
  title: string,
  area?: string
) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, permissions')
    .eq('email', user.email)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!profile) return { error: 'Profile not found' }

  const permissions = (profile.permissions as Record<string, boolean> | null) ?? {}
  if (!permissions.supervisor) return { error: 'Not a supervisor' }

  const { data: member } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('profile_id', profile.id)
    .eq('project_id', projectId)
    .maybeSingle()

  if (!member) return { error: 'Not a project member' }

  const { data: task, error: insertErr } = await supabase
    .from('tasks')
    .insert({
      title: title.trim(),
      project_id: projectId,
      company_id: user.company_id,
      column_id: columnId ?? null,
      area: area?.trim() || null,
      status: 'pending',
      checklist: [],
    })
    .select('id, title, status, area, priority, due_date, notes, checklist, assigned_to, column_id, label_color')
    .maybeSingle()

  if (insertErr) return { error: insertErr.message }
  if (!task) return { error: 'Failed to create task' }

  await supabase.from('task_audit_log').insert({
    task_id: task.id,
    project_id: projectId,
    company_id: user.company_id,
    changed_by_profile_id: profile.id,
    changed_by_name: profile.full_name,
    task_title: task.title,
    changes: [{ field: 'status', old_value: null, new_value: 'pending' }],
  })

  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/admin/projects/${projectId}`)
  return { ok: true, task }
}

export async function updateSupervisorTask(
  taskId: string,
  updates: {
    title?: string
    status?: string
    checklist?: { text: string; done: boolean }[]
    notes?: string
  }
) {
  const user = getCurrentUser()
  if (!user) return { error: 'Unauthorized' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, permissions')
    .eq('email', user.email)
    .eq('company_id', user.company_id)
    .maybeSingle()

  if (!profile) return { error: 'Profile not found' }

  const permissions = (profile.permissions as Record<string, boolean> | null) ?? {}
  if (!permissions.supervisor) return { error: 'Not a supervisor' }

  const { data: currentTask } = await supabase
    .from('tasks')
    .select('id, title, status, checklist, notes, project_id')
    .eq('id', taskId)
    .maybeSingle()

  if (!currentTask) return { error: 'Task not found' }

  const { data: member } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('profile_id', profile.id)
    .eq('project_id', currentTask.project_id)
    .maybeSingle()

  if (!member) return { error: 'Not a project member' }

  const changes: { field: string; old_value: unknown; new_value: unknown }[] = []
  const payload: Record<string, unknown> = {}

  if (updates.status !== undefined && updates.status !== currentTask.status) {
    changes.push({ field: 'status', old_value: currentTask.status, new_value: updates.status })
    payload.status = updates.status
  }

  if (updates.checklist !== undefined) {
    const oldJson = JSON.stringify(currentTask.checklist ?? [])
    const newJson = JSON.stringify(updates.checklist)
    if (oldJson !== newJson) {
      changes.push({ field: 'checklist', old_value: currentTask.checklist ?? [], new_value: updates.checklist })
      payload.checklist = updates.checklist
    }
  }

  if (updates.title !== undefined && updates.title.trim() !== '' && updates.title !== currentTask.title) {
    changes.push({ field: 'title', old_value: currentTask.title, new_value: updates.title })
    payload.title = updates.title
  }

  const currentNotes = (currentTask as Record<string, unknown>).notes as string ?? ''
  if (updates.notes !== undefined && updates.notes !== currentNotes) {
    changes.push({ field: 'notes', old_value: currentNotes, new_value: updates.notes })
    payload.notes = updates.notes
  }

  if (Object.keys(payload).length === 0) return { ok: true }

  const { error: updateErr } = await supabase.from('tasks').update(payload).eq('id', taskId)
  if (updateErr) return { error: updateErr.message }

  if (changes.length > 0) {
    await supabase.from('task_audit_log').insert({
      task_id: taskId,
      project_id: currentTask.project_id,
      company_id: user.company_id,
      changed_by_profile_id: profile.id,
      changed_by_name: profile.full_name,
      task_title: currentTask.title,
      changes,
    })
  }

  if (payload.status === 'completed' && user.company_id) {
    await notifyProfiles(await companyAdminIds(user.company_id), 'tasks', {
      title: 'Task completed ✅',
      body: `${profile.full_name} completed "${currentTask.title}"`,
      url: `/admin/projects/${currentTask.project_id}`,
    })
  }

  revalidatePath(`/projects/${currentTask.project_id}`)
  revalidatePath(`/admin/projects/${currentTask.project_id}`)
  return { ok: true }
}

export async function markAuditLogsRead(companyId: string) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') return { error: 'Unauthorized' }

  const supabase = createClient()
  await supabase
    .from('task_audit_log')
    .update({ is_read: true })
    .eq('company_id', companyId)
    .eq('is_read', false)

  revalidatePath('/admin/tasks')
  return { ok: true }
}
