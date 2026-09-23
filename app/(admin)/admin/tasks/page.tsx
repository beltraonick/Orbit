'use client'

import { writeFailed } from '@/lib/write-feedback'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { PhotoPicker } from '@/components/ui/PhotoPicker'
import { PhotoLightbox, type LightboxPhoto } from '@/components/ui/PhotoLightbox'
import { queuePhoto } from '@/lib/offline-photo-queue'
import { useOfflinePhotoSync } from '@/lib/useOfflinePhotoSync'
import { TaskAuditAlerts } from '@/components/admin/TaskAuditAlerts'

interface ChecklistItem { text: string; done: boolean }

interface Task {
  id: string
  title: string
  description: string | null
  area: string | null
  priority: string
  status: string
  estimated_hours: number | null
  due_date: string | null
  checklist: ChecklistItem[]
  notes: string | null
  completed_at: string | null
  created_at: string
  project_id: string | null
  assigned_to: string | null
  assigned_employee_id: string | null
  room_id: string | null
  label_color: string | null
  project: { name: string } | null
  assigned_employee: { full_name: string } | null
}

interface Profile { id: string; full_name: string }
interface Project { id: string; name: string; cover_image_path: string | null }
interface Room { id: string; project_id: string; floor: string | null; label: string }

const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-blue',
  medium: 'bg-amber',
  high: 'bg-danger/70',
  urgent: 'bg-danger',
}

const LABEL_COLORS = [
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#22C55E',
  '#14B8A6',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#6B7280',
]

const STATUS_VARIANTS: Record<string, 'gray' | 'amber' | 'blue' | 'green'> = {
  pending: 'gray',
  in_progress: 'amber',
  completed: 'green',
}

const BLANK = {
  title: '', description: '', area: '', priority: 'medium',
  status: 'pending', estimated_hours: '', due_date: '',
  project_id: '', assigned_employee_id: '', notes: '', room_id: '',
  checklist: [] as ChecklistItem[],
  label_color: null as string | null,
}

export default function TasksPage() {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  useOfflinePhotoSync(companyId)
  const [tasks, setTasks] = useState<Task[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [newCheckItem, setNewCheckItem] = useState('')
  const [editPhotos, setEditPhotos] = useState<{ id: string; storage_path: string }[]>([])
  const [newPhotoFiles, setNewPhotoFiles] = useState<File[]>([])
  const [uploadingPhotos, setUploadingPhotos] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [photoLightbox, setPhotoLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null)
  const [bulkAssignProject, setBulkAssignProject] = useState<{ id: string; name: string } | null>(null)
  const [bulkAssignEmpId, setBulkAssignEmpId] = useState('')
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<'assign' | 'delete' | 'move' | null>(null)
  const [bulkTargetEmpId, setBulkTargetEmpId] = useState('')
  const [bulkTargetProjectId, setBulkTargetProjectId] = useState('')
  const [bulkOperating, setBulkOperating] = useState(false)
  const [assigneesMap, setAssigneesMap] = useState<Record<string, { id: string; name: string }[]>>({})
  const [editAssignees, setEditAssignees] = useState<{ id: string; name: string }[]>([])
  const [addEmpId, setAddEmpId] = useState('')
  type AuditEntry = { id: string; task_title: string | null; changed_by_name: string | null; changes: { field: string; old_value: unknown; new_value: unknown }[]; created_at: string }
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])

  const PRIORITY_OPTIONS = [
    { value: 'low', label: t('common.priority.low') },
    { value: 'medium', label: t('common.priority.medium') },
    { value: 'high', label: t('common.priority.high') },
    { value: 'urgent', label: t('common.priority.urgent') },
  ]

  const STATUS_OPTIONS = [
    { value: 'pending', label: t('common.pending') },
    { value: 'in_progress', label: t('common.inProgress') },
    { value: 'completed', label: t('common.completed') },
  ]

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const [{ data: td }, { data: emps }, { data: projs }, { data: rms }] = await Promise.all([
      supabase
        .from('tasks')
        .select('*, project:project_id(name), assigned_employee:assigned_to(full_name)')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId).eq('auth_status', 'approved').order('full_name'),
      supabase.from('projects').select('id, name, cover_image_path').eq('company_id', companyId).order('name'),
      supabase.from('project_rooms').select('id, project_id, floor, label').eq('company_id', companyId),
    ])
    const loadedTasks = (td ?? []) as unknown as Task[]
    setTasks(loadedTasks)
    setEmployees(emps ?? [])
    setProjects(projs ?? [])
    setRooms(rms ?? [])

    // Load all assignees from task_assignments join table
    const taskIds = loadedTasks.map(t => t.id)
    if (taskIds.length > 0) {
      const { data: assignRows } = await supabase
        .from('task_assignments')
        .select('task_id, profile:profile_id(id, full_name)')
        .in('task_id', taskIds)
      const map: Record<string, { id: string; name: string }[]> = {}
      for (const row of assignRows ?? []) {
        const p = row.profile as unknown as { id: string; full_name: string } | null
        if (!p) continue
        if (!map[row.task_id]) map[row.task_id] = []
        map[row.task_id].push({ id: p.id, name: p.full_name })
      }
      setAssigneesMap(map)
    } else {
      setAssigneesMap({})
    }

    // Load unread audit entries from employees
    try {
      const { data: auditRows } = await supabase
        .from('task_audit_log')
        .select('id, task_title, changed_by_name, changes, created_at')
        .eq('company_id', companyId)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(20)
      setAuditEntries((auditRows ?? []) as AuditEntry[])
    } catch {
      // table may not exist yet
    }

    setLoading(false)
  }, [companyId])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)
    return () => clearInterval(interval)
  }, [load])

  // Lock background scroll while the modal is open — otherwise dragging
  // inside the (long, scrollable) form also scrolls the page behind it.
  useEffect(() => {
    if (!showModal) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [showModal])

  function openAdd(presetProjectId?: string) {
    setEditing(null)
    setForm({ ...BLANK, project_id: presetProjectId ?? '' })
    setEditPhotos([])
    setNewPhotoFiles([])
    setSaveError('')
    setEditAssignees([])
    setAddEmpId('')
    setShowModal(true)
  }

  async function openEdit(task: Task) {
    setEditing(task)
    setForm({
      title: task.title,
      description: task.description ?? '',
      area: task.area ?? '',
      priority: task.priority,
      status: task.status,
      estimated_hours: task.estimated_hours != null ? String(task.estimated_hours) : '',
      due_date: task.due_date ?? '',
      project_id: task.project_id ?? '',
      assigned_employee_id: task.assigned_to ?? task.assigned_employee_id ?? '',
      notes: task.notes ?? '',
      room_id: task.room_id ?? '',
      checklist: task.checklist ?? [],
      label_color: task.label_color ?? null,
    })
    setEditPhotos([])
    setNewPhotoFiles([])
    setSaveError('')
    setEditAssignees(assigneesMap[task.id] ?? [])
    setAddEmpId('')
    setShowModal(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('task_media')
      .select('id, storage_path')
      .eq('task_id', task.id)
      .eq('media_type', 'photo')
      .order('created_at', { ascending: false })
    setEditPhotos(data ?? [])
  }

  function editPhotoUrl(path: string) {
    return createClient().storage.from('task-photos').getPublicUrl(path).data.publicUrl
  }

  function projectCoverUrl(path: string) {
    return createClient().storage.from('project-photos').getPublicUrl(path).data.publicUrl
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaveError('')
    setSaving(true)
    const supabase = createClient()

    const primaryAssigneeId = editAssignees[0]?.id ?? null
    const payload = {
      title: form.title,
      description: form.description || null,
      status: form.status,
      due_date: form.due_date || null,
      project_id: form.project_id || null,
      assigned_to: primaryAssigneeId,
      assigned_employee_id: primaryAssigneeId,
      area: form.area || null,
      priority: form.priority,
      estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : null,
      notes: form.notes || null,
      checklist: form.checklist,
      completed_at: form.status === 'completed' ? new Date().toISOString() : null,
      room_id: form.room_id || null,
      label_color: form.label_color || null,
      updated_at: new Date().toISOString(),
    }

    let savedTaskId: string | null = editing?.id ?? null

    if (editing) {
      const { error } = await supabase.from('tasks').update(payload).eq('id', editing.id)
      if (error) {
        // Retry with minimal payload in case of extra column errors
        const { error: e2 } = await supabase.from('tasks').update({
          title: payload.title, description: payload.description, status: payload.status,
          due_date: payload.due_date, project_id: payload.project_id,
          assigned_to: payload.assigned_to, updated_at: payload.updated_at,
        }).eq('id', editing.id)
        if (e2) { setSaveError(e2.message); setSaving(false); return }
      }
    } else {
      const { data: inserted, error } = await supabase
        .from('tasks')
        .insert({ ...payload, company_id: companyId })
        .select('id')
        .single()
      if (error) {
        // Retry with minimal payload
        const { data: ins2, error: e2 } = await supabase
          .from('tasks')
          .insert({
            title: payload.title, description: payload.description, status: payload.status,
            due_date: payload.due_date, project_id: payload.project_id,
            assigned_to: payload.assigned_to, company_id: companyId,
          })
          .select('id')
          .single()
        if (e2) { setSaveError(e2.message); setSaving(false); return }
        savedTaskId = ins2?.id ?? null
      } else {
        savedTaskId = inserted?.id ?? null
      }
    }

    // Sync task_assignments join table — preserves all selected assignees
    if (savedTaskId) {
      writeFailed((await supabase.from('task_assignments').delete().eq('task_id', savedTaskId)).error, 'save your changes')
      if (editAssignees.length > 0) {
        writeFailed((await supabase.from('task_assignments').insert(
          editAssignees.map(a => ({ task_id: savedTaskId, profile_id: a.id }))
        )).error, 'save your changes')
      }
    }

    // Upload photos
    if (newPhotoFiles.length > 0 && savedTaskId) {
      setUploadingPhotos(true)
      for (const file of newPhotoFiles) {
        const ext = file.name.split('.').pop() ?? 'jpg'
        const path = `tasks/${savedTaskId}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
        if (!navigator.onLine) {
          const fileData = await file.arrayBuffer()
          await queuePhoto({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            taskId: savedTaskId,
            companyId,
            fileName: file.name,
            fileType: file.type,
            fileData,
            photoCategory: 'progress',
            queuedAt: new Date().toISOString(),
          })
        } else {
          const { error: upErr } = await supabase.storage.from('task-photos').upload(path, file, { upsert: false })
          if (!upErr) {
            const { error: mediaErr } = await supabase.from('task_media').insert({
              task_id: savedTaskId,
              company_id: companyId,
              storage_path: path,
              media_type: 'photo',
              photo_category: 'progress',
            })
            writeFailed(mediaErr, `attach ${file.name}`)
          } else writeFailed(upErr, `upload ${file.name}`)
        }
      }
      setUploadingPhotos(false)
      setNewPhotoFiles([])
    }

    setSaving(false)
    setShowModal(false)
    // Recalculate progress — both the new project and the old one if the task was moved
    const newProjectId = form.project_id || null
    const oldProjectId = editing?.project_id || null
    if (newProjectId) await recalcProjectProgress(newProjectId)
    if (oldProjectId && oldProjectId !== newProjectId) await recalcProjectProgress(oldProjectId)
    load()
  }

  async function quickStatus(id: string, status: string) {
    const supabase = createClient()
    writeFailed((await supabase.from('tasks').update({
      status,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq('id', id)).error, 'save your changes')
    // Recalculate progress for the task's project
    const task = tasks.find(t => t.id === id)
    if (task?.project_id) {
      await recalcProjectProgress(task.project_id)
    }
    load()
  }

  async function recalcProjectProgress(projectId: string) {
    const supabase = createClient()
    const { data } = await supabase
      .from('tasks')
      .select('status')
      .eq('project_id', projectId)
      .eq('company_id', companyId)
    if (!data || data.length === 0) return
    const completed = data.filter(t => t.status === 'completed').length
    const progress = Math.round((completed / data.length) * 100)
    writeFailed((await supabase.from('projects').update({ progress }).eq('id', projectId)).error, 'save your changes')
  }

  async function handleBulkAssign() {
    if (!bulkAssignProject) return
    setBulkAssigning(true)
    const supabase = createClient()
    const projectTaskIds = tasks.filter(t => t.project_id === bulkAssignProject.id).map(t => t.id)
    if (projectTaskIds.length > 0 && bulkAssignEmpId) {
      writeFailed((await supabase.from('task_assignments').upsert(
        projectTaskIds.map(tid => ({ task_id: tid, profile_id: bulkAssignEmpId })),
        { onConflict: 'task_id,profile_id' }
      )).error, 'save your changes')
    }
    setBulkAssigning(false)
    setBulkAssignProject(null)
    setBulkAssignEmpId('')
    load()
  }

  async function deleteTask(id: string) {
    if (!confirm(t('admin.tasks.confirmDelete'))) return
    const projectId = tasks.find(t => t.id === id)?.project_id ?? null
    const supabase = createClient()
    writeFailed((await supabase.from('tasks').delete().eq('id', id)).error, 'delete this item')
    if (projectId) await recalcProjectProgress(projectId)
    load()
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    if (!confirm(t('admin.tasks.bulkDeleteConfirm').replace('{n}', String(ids.length)))) return
    setBulkOperating(true)
    const supabase = createClient()
    const affectedPids = Array.from(new Set(ids.map(id => tasks.find(t => t.id === id)?.project_id).filter(Boolean) as string[]))
    writeFailed((await supabase.from('tasks').delete().in('id', ids)).error, 'delete this item')
    for (const pid of affectedPids) await recalcProjectProgress(pid)
    setBulkOperating(false)
    setSelectMode(false)
    setSelectedIds(new Set())
    load()
  }

  async function handleBulkMove() {
    if (!bulkTargetProjectId) return
    const ids = Array.from(selectedIds)
    setBulkOperating(true)
    const supabase = createClient()
    const oldPids = Array.from(new Set(ids.map(id => tasks.find(t => t.id === id)?.project_id).filter(Boolean) as string[]))
    writeFailed((await supabase.from('tasks').update({ project_id: bulkTargetProjectId, updated_at: new Date().toISOString() }).in('id', ids)).error, 'save your changes')
    await recalcProjectProgress(bulkTargetProjectId)
    for (const pid of oldPids) { if (pid !== bulkTargetProjectId) await recalcProjectProgress(pid) }
    setBulkOperating(false)
    setBulkAction(null)
    setBulkTargetProjectId('')
    setSelectMode(false)
    setSelectedIds(new Set())
    load()
  }

  async function handleBulkAssignSelected() {
    const ids = Array.from(selectedIds)
    setBulkOperating(true)
    const supabase = createClient()
    if (bulkTargetEmpId) {
      writeFailed((await supabase.from('task_assignments').upsert(
        ids.map(id => ({ task_id: id, profile_id: bulkTargetEmpId })),
        { onConflict: 'task_id,profile_id' }
      )).error, 'save your changes')
    }
    setBulkOperating(false)
    setBulkAction(null)
    setBulkTargetEmpId('')
    setSelectMode(false)
    setSelectedIds(new Set())
    load()
  }

  function addCheckItem() {
    if (!newCheckItem.trim()) return
    setForm(f => ({ ...f, checklist: [...f.checklist, { text: newCheckItem.trim(), done: false }] }))
    setNewCheckItem('')
  }

  function roomOptionsFor(pid: string) {
    const projectRooms = rooms.filter(r => r.project_id === pid)
    return [
      { value: '', label: t('admin.tasks.noRoom') },
      ...projectRooms.map(r => ({ value: r.id, label: [r.floor, r.label].filter(Boolean).join(' — ') })),
    ]
  }

  const empOptions = [
    { value: '', label: t('admin.tasks.unassigned') },
    ...employees.map(e => ({ value: e.id, label: e.full_name })),
  ]

  const projOptions = [
    { value: '', label: t('admin.tasks.noProject') },
    ...projects.map(p => ({ value: p.id, label: p.name })),
  ]

  // Group tasks by project for the board view
  const projectsWithTasks = projects.map(p => ({
    project: p,
    tasks: tasks.filter(t => t.project_id === p.id),
  })).filter(g => g.tasks.length > 0 || true) // show all projects even if empty

  const unassignedTasks = tasks.filter(t => !t.project_id)

  const counts = {
    pending: tasks.filter(t => t.status === 'pending').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  }

  function TaskRow({ task }: { task: Task }) {
    const doneItems = (task.checklist ?? []).filter(c => c.done).length
    const totalItems = (task.checklist ?? []).length
    const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed'
    const isSelected = selectedIds.has(task.id)

    function handleStatusCircle(e: React.MouseEvent) {
      e.stopPropagation()
      quickStatus(task.id, task.status === 'completed' ? 'pending' : 'completed')
    }

    return (
      <div
        className={[
          'group px-3 py-3 flex items-start gap-2.5 rounded-button transition-colors cursor-pointer',
          task.label_color ? '' : 'hover:bg-surface-elevated/70',
          isSelected ? 'bg-brand/5' : '',
        ].join(' ')}
        style={task.label_color ? { backgroundColor: task.label_color + '18' } : undefined}
        onClick={() => selectMode ? toggleSelect(task.id) : openEdit(task)}
      >
        {/* Status circle (always visible) / checkbox in select mode */}
        {selectMode ? (
          <div className="mt-1 flex-shrink-0">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleSelect(task.id)}
              onClick={e => e.stopPropagation()}
              className="w-4 h-4 rounded accent-brand cursor-pointer"
            />
          </div>
        ) : (
          <button
            onClick={handleStatusCircle}
            className={[
              'mt-0.5 w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center transition-all',
              task.status === 'completed'
                ? 'bg-green border-0'
                : task.status === 'in_progress'
                  ? 'border-2 border-amber bg-amber/10'
                  : 'border-2 border-[var(--border-strong)] bg-transparent hover:border-green/60',
            ].join(' ')}
            title={task.status === 'completed' ? 'Reopen' : 'Mark complete'}
          >
            {task.status === 'completed' && (
              <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            {task.status === 'in_progress' && (
              <div className="w-2 h-2 rounded-full bg-amber" />
            )}
          </button>
        )}

        {/* Priority dot */}
        <div
          className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${task.label_color ? '' : (PRIORITY_DOT[task.priority] ?? 'bg-secondary')}`}
          style={task.label_color ? { backgroundColor: task.label_color } : undefined}
        />

        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium leading-snug ${task.status === 'completed' ? 'text-tertiary line-through' : 'text-primary'}`}>
            {task.title}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant={STATUS_VARIANTS[task.status] ?? 'gray'} className="text-[10px]">
              {task.status === 'in_progress' ? t('common.inProgress')
                : task.status === 'pending' ? t('common.pending')
                : t('common.completed')}
            </Badge>
            {(assigneesMap[task.id]?.length ?? 0) > 0 && (
              <span className="text-[11px] text-secondary">
                {assigneesMap[task.id].map(a => a.name.split(' ')[0]).join(', ')}
              </span>
            )}
            {task.area && (
              <span className="text-[11px] text-tertiary truncate max-w-[100px]">{task.area}</span>
            )}
            {totalItems > 0 && (
              <span className="text-[11px] text-tertiary">{doneItems}/{totalItems}</span>
            )}
            {task.due_date && (
              <span className={`text-[11px] ${isOverdue ? 'text-danger font-medium' : 'text-tertiary'}`}>
                {new Date(task.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons — hidden in select mode, always visible otherwise */}
        {!selectMode && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            <button
              onClick={e => { e.stopPropagation(); openEdit(task) }}
              className="p-1.5 rounded text-tertiary hover:text-primary hover:bg-surface-elevated transition-colors"
              title="Edit"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path d="M11.013 2.508a1.75 1.75 0 012.475 2.474L5.87 12.6l-3.371.749.749-3.371 7.765-7.47z"/>
              </svg>
            </button>
            <button
              onClick={e => { e.stopPropagation(); deleteTask(task.id) }}
              className="p-1.5 rounded text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
              title="Delete"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
                <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 000 1.5h.3l.815 8.15A1.5 1.5 0 005.357 15h5.285a1.5 1.5 0 001.493-1.35l.815-8.15h.3a.75.75 0 000-1.5H11v-.75A2.25 2.25 0 008.75 1h-1.5A2.25 2.25 0 005 3.25zm2.25-.75a.75.75 0 00-.75.75V4h3v-.75a.75.75 0 00-.75-.75h-1.5zM6.05 6a.75.75 0 01.787.713l.275 5.5a.75.75 0 01-1.498.075l-.275-5.5A.75.75 0 016.05 6zm3.9 0a.75.75 0 01.712.787l-.275 5.5a.75.75 0 01-1.498-.075l.275-5.5a.75.75 0 01.786-.711z" clipRule="evenodd"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-[1600px] overflow-x-hidden">
      {/* Employee change alerts */}
      <TaskAuditAlerts
        entries={auditEntries}
        companyId={companyId}
        locale="pt"
        onRead={() => setAuditEntries([])}
      />

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{t('admin.tasks.title')}</h1>
          <p className="text-sm text-secondary mt-1">
            {t('admin.tasks.summary').replace('{n}', String(counts.pending)).replace('{m}', String(counts.in_progress)).replace('{k}', String(counts.completed))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/admin/reports/task-report"
            className="px-3 py-2 rounded-button border border-[var(--border)] text-xs font-medium text-secondary hover:text-primary hover:bg-surface-elevated transition-colors"
          >
            Exportar PDF
          </a>
          <button
            onClick={() => { setSelectMode(m => !m); setSelectedIds(new Set()) }}
            className={[
              'px-3 py-2 rounded-button border text-xs font-medium transition-colors',
              selectMode
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-[var(--border)] text-secondary hover:text-primary hover:bg-surface-elevated',
            ].join(' ')}
          >
            {selectMode ? t('admin.tasks.exitSelect') : t('admin.tasks.selectMode')}
          </button>
          <Button onClick={() => openAdd()}>{t('admin.tasks.addTask')}</Button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {[
          { label: t('common.pending'), count: counts.pending, color: 'text-secondary' },
          { label: t('common.inProgress'), count: counts.in_progress, color: 'text-amber' },
          { label: t('common.completed'), count: counts.completed, color: 'text-green' },
        ].map(c => (
          <div key={c.label} className="bg-surface border border-[var(--border)] rounded-button px-3 py-1.5 flex items-center gap-2">
            <span className={`text-xs font-semibold ${c.color}`}>{c.count}</span>
            <span className="text-xs text-secondary">{c.label}</span>
          </div>
        ))}
      </div>

      {/* Board: one column per project */}
      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex-shrink-0 w-72 bg-surface border border-[var(--border)] rounded-card h-64 animate-pulse" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm font-medium text-primary mb-1">{t('admin.tasks.noTasksYet')}</p>
          <Button onClick={() => openAdd()} className="mt-4">{t('admin.tasks.createFirstTask')}</Button>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 md:-mx-8 md:px-8">
          {/* Project columns (only projects that have tasks) */}
          {projectsWithTasks
            .filter(g => g.tasks.length > 0)
            .map(({ project, tasks: projectTasks }) => (
              <div
                key={project.id}
                className="flex-shrink-0 w-72 bg-surface border border-[var(--border)] rounded-card overflow-hidden flex flex-col"
              >
                {/* Column header */}
                {(() => {
                  const completedCount = projectTasks.filter(t => t.status === 'completed').length
                  const colProgress = projectTasks.length > 0 ? Math.round((completedCount / projectTasks.length) * 100) : 0
                  return (
                    <div className="border-b border-[var(--border)]">
                      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {project.cover_image_path ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={projectCoverUrl(project.cover_image_path)}
                              alt=""
                              className="w-5 h-5 rounded-full object-cover flex-shrink-0 ring-1 ring-[var(--border)]"
                            />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-brand flex-shrink-0" />
                          )}
                          <h3 className="text-xs font-semibold text-primary truncate">{project.name}</h3>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[10px] text-tertiary bg-surface-elevated rounded-full px-1.5 py-0.5">
                            {projectTasks.length}
                          </span>
                          <button
                            onClick={() => { setBulkAssignProject(project); setBulkAssignEmpId('') }}
                            className="w-5 h-5 rounded flex items-center justify-center text-tertiary hover:text-brand hover:bg-brand/10 transition-colors"
                            title={t('admin.tasks.bulkAssignTitle')}
                          >
                            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                              <path d="M6 3.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zM8 7a4 4 0 00-4 4v.5a.5.5 0 001 0V11a3 3 0 016 0v.5a.5.5 0 001 0V11a4 4 0 00-4-4zm5.5-1a.5.5 0 01.5.5v1h1a.5.5 0 010 1h-1v1a.5.5 0 01-1 0v-1h-1a.5.5 0 010-1h1v-1a.5.5 0 01.5-.5z"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => openAdd(project.id)}
                            className="w-5 h-5 rounded flex items-center justify-center text-tertiary hover:text-brand hover:bg-brand/10 transition-colors"
                            title={t('admin.tasks.addTask')}
                          >
                            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                              <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5H2.75a.75.75 0 010-1.5h4.5V2.75A.75.75 0 018 2z"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="px-3 pb-2.5">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[10px] text-tertiary tabular-nums">
                            {completedCount}/{projectTasks.length}
                          </span>
                          <span className={`text-[10px] font-semibold tabular-nums transition-colors ${colProgress === 100 ? 'text-green' : colProgress > 0 ? 'text-brand' : 'text-tertiary'}`}>
                            {colProgress}%
                          </span>
                        </div>
                        <div className="h-[3px] bg-[var(--border)] rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ease-out ${colProgress === 100 ? 'bg-green' : 'bg-brand'}`}
                            style={{ width: `${colProgress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })()}

                {/* Tasks list */}
                <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
                  {projectTasks.map(task => (
                    <TaskRow key={task.id} task={task} />
                  ))}
                </div>
              </div>
            ))}

          {/* Unassigned column */}
          {unassignedTasks.length > 0 && (
            <div className="flex-shrink-0 w-72 bg-surface border border-[var(--border)] rounded-card overflow-hidden flex flex-col">
              <div className="px-3 py-3 border-b border-[var(--border)] flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-tertiary flex-shrink-0" />
                  <h3 className="text-xs font-semibold text-secondary truncate">{t('admin.tasks.noProject')}</h3>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <span className="text-[10px] text-tertiary bg-surface-elevated rounded-full px-1.5 py-0.5">
                    {unassignedTasks.length}
                  </span>
                  <button
                    onClick={() => openAdd()}
                    className="w-5 h-5 rounded flex items-center justify-center text-tertiary hover:text-brand hover:bg-brand/10 transition-colors"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5H2.75a.75.75 0 010-1.5h4.5V2.75A.75.75 0 018 2z"/>
                    </svg>
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]">
                {unassignedTasks.map(task => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
            </div>
          )}

          {/* Add to any project buttons for projects with 0 tasks */}
          {projectsWithTasks
            .filter(g => g.tasks.length === 0)
            .map(({ project }) => (
              <div
                key={project.id}
                className="flex-shrink-0 w-72 border-2 border-dashed border-[var(--border)] rounded-card overflow-hidden flex flex-col"
              >
                <div className="px-3 py-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-full bg-tertiary/40 flex-shrink-0" />
                    <h3 className="text-xs font-semibold text-tertiary truncate">{project.name}</h3>
                  </div>
                  <button
                    onClick={() => openAdd(project.id)}
                    className="w-5 h-5 rounded flex items-center justify-center text-tertiary hover:text-brand hover:bg-brand/10 transition-colors"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5H2.75a.75.75 0 010-1.5h4.5V2.75A.75.75 0 018 2z"/>
                    </svg>
                  </button>
                </div>
                <div className="flex-1 flex items-center justify-center pb-6">
                  <p className="text-xs text-tertiary">{t('admin.tasks.noTasksYet')}</p>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Floating multi-select action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-surface border border-[var(--border)] rounded-card shadow-2xl px-4 py-3 flex items-center gap-3 min-w-[300px] max-w-[90vw]">
          <span className="text-sm font-semibold text-primary whitespace-nowrap">
            {t('admin.tasks.selected').replace('{n}', String(selectedIds.size))}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => { setBulkTargetEmpId(''); setBulkAction('assign') }}
            disabled={bulkOperating}
            className="px-3 py-1.5 rounded-button text-xs font-medium bg-brand/10 text-brand hover:bg-brand/20 transition-colors disabled:opacity-50"
          >
            {t('admin.tasks.bulkAssignSelected')}
          </button>
          <button
            onClick={() => { setBulkTargetProjectId(''); setBulkAction('move') }}
            disabled={bulkOperating}
            className="px-3 py-1.5 rounded-button text-xs font-medium bg-surface-elevated text-secondary hover:text-primary hover:bg-surface-elevated/80 transition-colors border border-[var(--border)] disabled:opacity-50"
          >
            {t('admin.tasks.bulkMove')}
          </button>
          <button
            onClick={handleBulkDelete}
            disabled={bulkOperating}
            className="px-3 py-1.5 rounded-button text-xs font-medium bg-danger/10 text-danger hover:bg-danger/20 transition-colors disabled:opacity-50"
          >
            {bulkOperating ? '…' : t('admin.tasks.bulkDelete')}
          </button>
        </div>
      )}

      {/* Bulk Assign Selected Modal */}
      {bulkAction === 'assign' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => { if (!bulkOperating) setBulkAction(null) }}
        >
          <div
            className="bg-surface rounded-card border border-[var(--border)] w-full max-w-sm p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-primary">
              {t('admin.tasks.bulkAssignSelectedTitle').replace('{n}', String(selectedIds.size))}
            </h2>
            <Select
              label={t('admin.tasks.assignedTo')}
              value={bulkTargetEmpId}
              onChange={e => setBulkTargetEmpId(e.target.value)}
              options={empOptions}
            />
            <div className="flex gap-2 justify-end mt-2">
              <Button variant="ghost" onClick={() => setBulkAction(null)} disabled={bulkOperating}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleBulkAssignSelected} disabled={bulkOperating || !bulkTargetEmpId} loading={bulkOperating}>
                {bulkOperating ? t('admin.tasks.bulkAssigningSelected') : t('admin.tasks.bulkAssignSelected')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Move Modal */}
      {bulkAction === 'move' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => { if (!bulkOperating) setBulkAction(null) }}
        >
          <div
            className="bg-surface rounded-card border border-[var(--border)] w-full max-w-sm p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-primary">
              {t('admin.tasks.bulkMoveTitle')}
            </h2>
            <Select
              label={t('admin.tasks.project')}
              value={bulkTargetProjectId}
              onChange={e => setBulkTargetProjectId(e.target.value)}
              options={projOptions.filter(o => o.value !== '')}
            />
            <div className="flex gap-2 justify-end mt-2">
              <Button variant="ghost" onClick={() => setBulkAction(null)} disabled={bulkOperating}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleBulkMove} disabled={bulkOperating || !bulkTargetProjectId} loading={bulkOperating}>
                {bulkOperating ? t('admin.tasks.bulkMoving') : t('admin.tasks.bulkMove')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Assign Modal */}
      {bulkAssignProject && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => { if (!bulkAssigning) setBulkAssignProject(null) }}
        >
          <div
            className="bg-surface rounded-card border border-[var(--border)] w-full max-w-sm p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-primary">
              {t('admin.tasks.bulkAssignTitle')}
            </h2>
            <p className="text-sm text-secondary -mt-2">{bulkAssignProject.name}</p>
            <Select
              label={t('admin.tasks.assignedTo')}
              value={bulkAssignEmpId}
              onChange={e => setBulkAssignEmpId(e.target.value)}
              options={empOptions}
            />
            <div className="flex gap-2 justify-end mt-2">
              <Button
                variant="ghost"
                onClick={() => setBulkAssignProject(null)}
                disabled={bulkAssigning}
              >
                {t('common.cancel')}
              </Button>
              <Button onClick={handleBulkAssign} disabled={bulkAssigning || !bulkAssignEmpId}>
                {bulkAssigning ? t('admin.tasks.bulkAssigning') : t('admin.tasks.bulkAssignConfirm')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-surface rounded-card border border-[var(--border)] w-full max-w-lg max-h-[90vh] overflow-y-auto overscroll-contain"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6">
              <h2 className="text-base font-semibold text-primary mb-5">
                {editing ? t('admin.tasks.editTask') : t('admin.tasks.newTask')}
              </h2>

              <form onSubmit={handleSave} className="space-y-4">
                <Input
                  label={t('admin.tasks.taskTitle')}
                  required
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder={t('admin.tasks.taskTitlePlaceholder')}
                />

                <div className="grid grid-cols-2 gap-3">
                  <Select
                    label={t('admin.tasks.priority')}
                    options={PRIORITY_OPTIONS}
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  />
                  <Select
                    label={t('admin.tasks.status')}
                    options={STATUS_OPTIONS}
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  />
                  <Select
                    label={t('admin.tasks.project')}
                    options={projOptions}
                    value={form.project_id}
                    onChange={e => setForm(f => ({ ...f, project_id: e.target.value, room_id: '' }))}
                  />
                  <div>
                    <p className="text-xs font-medium text-secondary mb-1.5">{t('admin.tasks.assignedTo')}</p>
                    {editAssignees.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {editAssignees.map(a => (
                          <span
                            key={a.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand/10 text-brand text-xs font-medium"
                          >
                            {a.name.split(' ')[0]}
                            <button
                              type="button"
                              onClick={() => setEditAssignees(prev => prev.filter(x => x.id !== a.id))}
                              className="ml-0.5 hover:opacity-70 leading-none"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <Select
                      label=""
                      options={[
                        { value: '', label: t('admin.tasks.addAssignee') },
                        ...employees
                          .filter(e => !editAssignees.find(a => a.id === e.id))
                          .map(e => ({ value: e.id, label: e.full_name })),
                      ]}
                      value={addEmpId}
                      onChange={e => {
                        const emp = employees.find(x => x.id === e.target.value)
                        if (emp) {
                          setEditAssignees(prev => [...prev, { id: emp.id, name: emp.full_name }])
                          setAddEmpId('')
                        }
                      }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Select
                      label={t('admin.tasks.room')}
                      options={roomOptionsFor(form.project_id)}
                      value={form.room_id}
                      onChange={e => {
                        const roomId = e.target.value
                        const room = rooms.find(r => r.id === roomId)
                        setForm(f => ({
                          ...f,
                          room_id: roomId,
                          area: room ? [room.floor, room.label].filter(Boolean).join(' — ') : f.area,
                        }))
                      }}
                    />
                    {form.project_id && roomOptionsFor(form.project_id).length === 1 && (
                      <p className="text-[10px] text-tertiary mt-1">No rooms for this project yet</p>
                    )}
                  </div>
                  <Input
                    label={t('admin.tasks.areaLocation')}
                    placeholder={t('admin.tasks.areaPlaceholder')}
                    value={form.area}
                    onChange={e => setForm(f => ({ ...f, area: e.target.value }))}
                  />
                </div>

                <Input
                  label={t('admin.tasks.dueDate')}
                  type="date"
                  value={form.due_date}
                  onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
                />

                <div>
                  <label className="block text-xs font-medium text-secondary mb-2">Color Label</label>
                  <div className="flex gap-1.5 items-center overflow-x-auto pb-0.5">
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, label_color: null }))}
                      title="No color"
                      className={[
                        'w-7 h-7 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all',
                        !form.label_color ? 'border-brand bg-surface-elevated' : 'border-[var(--border)] hover:border-[var(--border-strong)] bg-surface-elevated',
                      ].join(' ')}
                    >
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3 h-3 text-tertiary">
                        <path strokeLinecap="round" d="M1 1l10 10M11 1L1 11" />
                      </svg>
                    </button>
                    {LABEL_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, label_color: color }))}
                        title={color}
                        className="w-7 h-7 rounded-full flex-shrink-0 transition-transform hover:scale-110 active:scale-95"
                        style={{
                          backgroundColor: color,
                          outline: form.label_color === color ? `3px solid ${color}` : '2px solid transparent',
                          outlineOffset: '2px',
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-secondary mb-1.5">{t('admin.tasks.description')}</label>
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder={t('admin.tasks.descriptionPlaceholder')}
                    className="w-full bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none resize-none transition-colors"
                  />
                </div>

                {/* Photos */}
                <div>
                  <label className="block text-xs font-medium text-secondary mb-2">{t('admin.tasks.photos')}</label>
                  {editPhotos.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 mb-2">
                      {editPhotos.map((p, i) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPhotoLightbox({
                            photos: editPhotos.map(ep => ({
                              url: editPhotoUrl(ep.storage_path),
                              category: null,
                              uploaderName: null,
                              createdAt: null,
                              projectName: null,
                              taskTitle: editing?.title ?? null,
                            })),
                            index: i,
                          })}
                          className="flex-shrink-0 w-16 h-16 rounded-button overflow-hidden bg-surface-elevated"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={editPhotoUrl(p.storage_path)} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                  {newPhotoFiles.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 mb-2">
                      {newPhotoFiles.map((f, i) => (
                        <div key={i} className="flex-shrink-0 w-16 h-16 rounded-button overflow-hidden bg-surface-elevated relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={() => setNewPhotoFiles(prev => prev.filter((_, idx) => idx !== i))}
                            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 flex items-center justify-center"
                          >
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-2.5 h-2.5 text-white">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <PhotoPicker
                    onFiles={files => setNewPhotoFiles(prev => [...prev, ...files])}
                    trigger={open => (
                      <button
                        type="button"
                        onClick={open}
                        className="flex items-center gap-2 w-full border border-dashed border-[var(--border)] rounded-input px-3 py-2.5 hover:border-brand/40 transition-colors text-left"
                      >
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-tertiary flex-shrink-0">
                          <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                        </svg>
                        <span className="text-xs text-secondary">
                          {newPhotoFiles.length > 0
                            ? t('admin.tasks.photosSelected').replace('{n}', String(newPhotoFiles.length)).replace(/\{plural\}/g, newPhotoFiles.length > 1 ? 's' : '')
                            : t('admin.tasks.addPhotos')}
                        </span>
                      </button>
                    )}
                  />
                </div>

                {/* Checklist */}
                <div>
                  <label className="block text-xs font-medium text-secondary mb-2">{t('admin.tasks.checklist')}</label>
                  {form.checklist.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 mb-1.5">
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={e => {
                          const cl = [...form.checklist]
                          cl[i] = { ...cl[i], done: e.target.checked }
                          setForm(f => ({ ...f, checklist: cl }))
                        }}
                        className="rounded"
                      />
                      <span className={`text-sm flex-1 ${item.done ? 'text-tertiary line-through' : 'text-primary'}`}>{item.text}</span>
                      <button type="button" onClick={() => setForm(f => ({ ...f, checklist: f.checklist.filter((_, idx) => idx !== i) }))} className="text-tertiary hover:text-danger">
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      value={newCheckItem}
                      onChange={e => setNewCheckItem(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCheckItem() } }}
                      placeholder={t('admin.tasks.checklistPlaceholder')}
                      className="flex-1 bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2 border border-[var(--border)] focus:border-brand/50 outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={addCheckItem}
                      className="px-3 py-2 text-xs font-medium rounded-button bg-surface-elevated text-secondary hover:text-primary border border-[var(--border)] transition-colors"
                    >
                      {t('admin.tasks.add')}
                    </button>
                  </div>
                </div>

                {saveError && (
                  <div className="bg-danger/10 border border-danger/20 rounded-input px-3 py-2 text-xs text-danger">
                    {saveError}
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">{t('common.cancel')}</Button>
                  <Button type="submit" loading={saving || uploadingPhotos} className="flex-1">
                    {editing ? t('admin.tasks.save') : t('admin.tasks.createTask')}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {photoLightbox && (
        <PhotoLightbox
          photos={photoLightbox.photos}
          initialIndex={photoLightbox.index}
          onClose={() => setPhotoLightbox(null)}
        />
      )}
    </div>
  )
}
