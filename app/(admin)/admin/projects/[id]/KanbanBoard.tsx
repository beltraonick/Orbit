'use client'

import { notifyTaskAssigned } from '@/app/actions/notifications'

import { writeFailed } from '@/lib/write-feedback'
import { useState, useRef, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { useCurrentUser } from '@/lib/user-context'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { PhotoPicker } from '@/components/ui/PhotoPicker'
import { PhotoLightbox, type LightboxPhoto } from '@/components/ui/PhotoLightbox'
import { queuePhoto } from '@/lib/offline-photo-queue'
import { useOfflinePhotoSync } from '@/lib/useOfflinePhotoSync'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function taskPhotoUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/task-photos/${path}`
}

interface KanbanColumn {
  id: string
  name: string
  position: number
}

interface ChecklistItem { text: string; done: boolean }

interface KanbanTask {
  id: string
  title: string
  description: string | null
  area: string | null
  priority: string
  status: string
  due_date: string | null
  notes: string | null
  checklist: ChecklistItem[]
  assigned_to: string | null
  column_id: string | null
  room_id: string | null
  label_color: string | null
  created_at: string
  assigned_employee?: { full_name: string } | null
}

interface TaskPhoto {
  id: string
  storage_path: string
  photo_category: string | null
  uploaded_by_name: string | null
  created_at: string
}

interface Profile { id: string; full_name: string }
interface Room { id: string; label: string; floor: string | null }

const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-blue', medium: 'bg-amber', high: 'bg-danger/70', urgent: 'bg-danger',
}

const LABEL_COLORS = [
  '#EF4444', // red
  '#F97316', // orange
  '#EAB308', // yellow
  '#22C55E', // green
  '#14B8A6', // teal
  '#3B82F6', // blue
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#6B7280', // gray
]

// ─── Task Drawer ──────────────────────────────────────────────────────────────

function TaskDrawer({
  task,
  projectId,
  companyId,
  employees,
  rooms,
  columns,
  onClose,
  onUpdated,
  onDeleted,
}: {
  task: KanbanTask | null
  isNew: boolean
  projectId: string
  companyId: string
  employees: Profile[]
  rooms: Room[]
  columns: KanbanColumn[]
  onClose: () => void
  onUpdated: (t: KanbanTask) => void
  onDeleted: (id: string) => void
}) {
  const { t } = useTranslation()
  const currentUser = useCurrentUser()

  const blankForm = useCallback(() => ({
    title: task?.title ?? '',
    description: task?.description ?? '',
    area: task?.area ?? '',
    priority: task?.priority ?? 'medium',
    status: task?.status ?? 'pending',
    due_date: task?.due_date ?? '',
    notes: task?.notes ?? '',
    assignedIds: [] as string[],
    column_id: task?.column_id ?? '',
    room_id: task?.room_id ?? '',
    checklist: task?.checklist ?? [] as ChecklistItem[],
    label_color: task?.label_color ?? null as string | null,
  }), [task])

  const [form, setForm] = useState(blankForm)
  const [currentAssignmentIds, setCurrentAssignmentIds] = useState<string[]>([])
  const [photos, setPhotos] = useState<TaskPhoto[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [checkInput, setCheckInput] = useState('')
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null)

  useEffect(() => {
    setForm(blankForm())
    setCurrentAssignmentIds([])
    setNewFiles([])
    setPhotos([])
    setSaveError(null)
    if (task?.id) {
      setLoadingPhotos(true)
      const supabase = createClient()
      supabase.from('task_media').select('id, storage_path, photo_category, uploaded_by_name, created_at').eq('task_id', task.id).order('created_at').then(({ data }) => {
        setPhotos((data ?? []) as TaskPhoto[])
        setLoadingPhotos(false)
      })
      // Load current assignments from join table, falling back to assigned_to
      supabase.from('task_assignments').select('profile_id').eq('task_id', task.id).then(({ data, error }) => {
        let ids: string[]
        if (!error && data && data.length > 0) {
          ids = data.map((a: { profile_id: string }) => a.profile_id)
        } else {
          ids = task.assigned_to ? [task.assigned_to] : []
        }
        setCurrentAssignmentIds(ids)
        setForm(prev => ({ ...prev, assignedIds: ids }))
      })
    }
  }, [task, blankForm])

  const PRIORITY_OPTS = [
    { value: 'low',    label: t('common.priority.low') },
    { value: 'medium', label: t('common.priority.medium') },
    { value: 'high',   label: t('common.priority.high') },
    { value: 'urgent', label: t('common.priority.urgent') },
  ]
  const STATUS_OPTS = [
    { value: 'pending',     label: t('common.pending') },
    { value: 'in_progress', label: t('common.inProgress') },
    { value: 'completed',   label: t('common.completed') },
  ]
  const roomOpts = [
    { value: '', label: t('admin.projectDetail.kanbanRoom') },
    ...rooms.map(r => ({ value: r.id, label: r.floor ? `${r.floor} · ${r.label}` : r.label })),
  ]
  const columnOpts = [
    { value: '', label: '—' },
    ...columns.map(c => ({ value: c.id, label: c.name })),
  ]

  async function handleSave() {
    if (!form.title.trim()) return
    setSaving(true)
    setSaveError(null)
    const supabase = createClient()
    const primaryAssignee = form.assignedIds[0] ?? null
    const payload = {
      title: form.title.trim(),
      description: form.description || null,
      area: form.area || null,
      priority: form.priority,
      status: form.status,
      due_date: form.due_date || null,
      notes: form.notes || null,
      assigned_to: primaryAssignee,
      assigned_employee_id: primaryAssignee,
      column_id: form.column_id || null,
      room_id: form.room_id || null,
      checklist: form.checklist,
      label_color: form.label_color || null,
    }

    let savedTask: KanbanTask | null = null

    if (task?.id) {
      const { data, error } = await supabase.from('tasks').update(payload).eq('id', task.id).select('*, assigned_employee:assigned_to(full_name)').single()
      if (error) { setSaveError(error.message); setSaving(false); return }
      savedTask = data as KanbanTask
    } else {
      const { data, error } = await supabase.from('tasks').insert({ ...payload, project_id: projectId, company_id: companyId }).select('*, assigned_employee:assigned_to(full_name)').single()
      if (error) { setSaveError(error.message); setSaving(false); return }
      savedTask = data as KanbanTask
    }

    // Sync task_assignments join table
    const taskId = savedTask.id
    const toRemove = currentAssignmentIds.filter(id => !form.assignedIds.includes(id))
    const toAdd = form.assignedIds.filter(id => !currentAssignmentIds.includes(id))

    if (toRemove.length > 0) {
      writeFailed((await supabase.from('task_assignments').delete()
        .eq('task_id', taskId)
        .in('profile_id', toRemove)).error, 'save your changes')
    }
    const assignedNow: string[] = []
    for (const profileId of toAdd) {
      const { error: assignErr } = await supabase.from('task_assignments').upsert(
        { task_id: taskId, profile_id: profileId },
        { onConflict: 'task_id,profile_id' }
      )
      if (!writeFailed(assignErr, 'save your changes')) assignedNow.push(profileId)
    }
    if (assignedNow.length > 0) notifyTaskAssigned(taskId, assignedNow).catch(() => {})
    setCurrentAssignmentIds(form.assignedIds)

    // Upload new photos
    if (newFiles.length > 0 && savedTask?.id) {
      setUploading(true)
      for (const file of newFiles) {
        const ext = file.name.split('.').pop() ?? 'jpg'
        const path = `${companyId}/${savedTask.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        if (!navigator.onLine) {
          // Queue for later upload when offline
          const fileData = await file.arrayBuffer()
          await queuePhoto({
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            taskId: savedTask.id,
            companyId,
            fileName: file.name,
            fileType: file.type,
            fileData,
            photoCategory: 'progress',
            queuedAt: new Date().toISOString(),
          })
        } else {
          const { error } = await supabase.storage.from('task-photos').upload(path, file, { contentType: file.type })
          if (!error) {
            writeFailed((await supabase.from('task_media').insert({
              task_id: savedTask.id,
              project_id: projectId,
              company_id: companyId,
              media_type: 'photo',
              storage_path: path,
              photo_category: 'progress',
              uploaded_by_name: currentUser.name,
            })).error, 'save your changes')
          } else writeFailed(error, `upload ${file.name}`)
        }
      }
      setUploading(false)
      setNewFiles([])
      const { data: updatedPhotos } = await supabase.from('task_media').select('id, storage_path, photo_category, uploaded_by_name, created_at').eq('task_id', savedTask.id).order('created_at')
      setPhotos((updatedPhotos ?? []) as TaskPhoto[])
    }

    setSaving(false)
    if (savedTask) {
      onUpdated(savedTask)
    }
    // Recalculate project progress based on task completion
    const supabase2 = createClient()
    const { data: allTasks } = await supabase2.from('tasks').select('status').eq('project_id', projectId).eq('company_id', companyId)
    if (allTasks && allTasks.length > 0) {
      const completed = allTasks.filter(t => t.status === 'completed').length
      const progress = Math.round((completed / allTasks.length) * 100)
      await supabase2.from('projects').update({ progress }).eq('id', projectId)
    }
  }

  async function deletePhoto(photo: TaskPhoto) {
    const supabase = createClient()
    const [, { error }] = await Promise.all([
      supabase.storage.from('task-photos').remove([photo.storage_path]),
      supabase.from('task_media').delete().eq('id', photo.id),
    ])
    if (writeFailed(error, 'delete this photo')) return
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
  }

  async function handleDeleteTask() {
    if (!task?.id) return
    if (!window.confirm(t('admin.projectDetail.kanbanDeleteTaskConfirm'))) return
    const supabase = createClient()
    writeFailed((await supabase.from('tasks').delete().eq('id', task.id)).error, 'delete this item')
    onDeleted(task.id)
    // Recalculate project progress
    const { data: allTasks } = await supabase.from('tasks').select('status').eq('project_id', projectId).eq('company_id', companyId)
    if (allTasks && allTasks.length > 0) {
      const completed = allTasks.filter(t => t.status === 'completed').length
      const progress = Math.round((completed / allTasks.length) * 100)
      writeFailed((await supabase.from('projects').update({ progress }).eq('id', projectId)).error, 'save your changes')
    } else if (allTasks?.length === 0) {
      writeFailed((await supabase.from('projects').update({ progress: 0 }).eq('id', projectId)).error, 'save your changes')
    }
  }

  function addCheckItem() {
    const text = checkInput.trim()
    if (!text) return
    setForm(f => ({ ...f, checklist: [...f.checklist, { text, done: false }] }))
    setCheckInput('')
  }

  function toggleCheckItem(i: number) {
    setForm(f => {
      const c = [...f.checklist]
      c[i] = { ...c[i], done: !c[i].done }
      return { ...f, checklist: c }
    })
  }

  function removeCheckItem(i: number) {
    setForm(f => ({ ...f, checklist: f.checklist.filter((_, idx) => idx !== i) }))
  }

  const allPhotos = [
    ...photos.map(p => ({ id: p.id, url: taskPhotoUrl(p.storage_path), isNew: false, photo: p, uploaderName: p.uploaded_by_name, createdAt: p.created_at, category: p.photo_category ?? 'progress' })),
    ...newFiles.map((f, i) => ({ id: `new-${i}`, url: URL.createObjectURL(f), isNew: true, photo: null, uploaderName: currentUser.name, createdAt: null, category: 'progress' })),
  ]

  const photosByCategory = {
    before: allPhotos.filter(p => p.category === 'before'),
    progress: allPhotos.filter(p => p.category === 'progress' || (p.category !== 'before' && p.category !== 'after')),
    after: allPhotos.filter(p => p.category === 'after'),
  }

  const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
    before: { label: 'Before', color: 'text-amber' },
    progress: { label: 'Progress', color: 'text-blue' },
    after: { label: 'After', color: 'text-green' },
  }

  const doneCount = form.checklist.filter(c => c.done).length

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-surface border-l border-[var(--border)] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <h2 className="text-sm font-semibold text-primary">
            {task?.id ? t('admin.projectDetail.kanbanEditTask') : t('admin.projectDetail.kanbanNewTask')}
          </h2>
          <div className="flex items-center gap-2">
            {task?.id && (
              <button
                onClick={handleDeleteTask}
                className="text-xs text-danger hover:text-danger/80 transition-colors px-2 py-1 rounded-button hover:bg-danger/10"
              >
                {t('admin.projectDetail.kanbanDeleteTask')}
              </button>
            )}
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-button flex items-center justify-center text-secondary hover:text-primary hover:bg-surface-elevated transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">{t('admin.projectDetail.kanbanTaskTitle')}</label>
            <textarea
              rows={2}
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder={t('admin.projectDetail.kanbanTaskTitlePlaceholder')}
              className="w-full bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none resize-none"
            />
          </div>

          {/* Status + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label={t('admin.projectDetail.kanbanStatus')}
              options={STATUS_OPTS}
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
            />
            <Select
              label={t('admin.projectDetail.kanbanPriority')}
              options={PRIORITY_OPTS}
              value={form.priority}
              onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
            />
          </div>

          {/* Column + Assignee */}
          <div className="space-y-3">
            <Select
              label="Column"
              options={columnOpts}
              value={form.column_id}
              onChange={e => setForm(f => ({ ...f, column_id: e.target.value }))}
            />
            {/* Multi-employee selector */}
            <div>
              <label className="block text-xs font-medium text-secondary mb-1.5">
                {t('admin.projectDetail.kanbanAssignee')}
              </label>
              {form.assignedIds.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {form.assignedIds.map(id => {
                    const emp = employees.find(e => e.id === id)
                    if (!emp) return null
                    return (
                      <div key={id} className="flex items-center gap-1 px-2.5 py-1 bg-surface-elevated rounded-full border border-[var(--border)] text-xs">
                        <span className="text-primary font-medium">{emp.full_name.split(' ')[0]}</span>
                        <button
                          type="button"
                          onClick={() => setForm(f => ({ ...f, assignedIds: f.assignedIds.filter(x => x !== id) }))}
                          className="text-tertiary hover:text-danger transition-colors ml-0.5 flex-shrink-0"
                          aria-label={`Remove ${emp.full_name}`}
                        >
                          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-2.5 h-2.5">
                            <path d="M1 1l10 10M11 1L1 11"/>
                          </svg>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              <select
                className="w-full bg-surface-elevated text-sm text-primary rounded-input px-3 py-2 border border-[var(--border)] focus:border-brand/50 outline-none"
                value=""
                onChange={e => {
                  const id = e.target.value
                  if (id && !form.assignedIds.includes(id)) {
                    setForm(f => ({ ...f, assignedIds: [...f.assignedIds, id] }))
                  }
                  e.target.value = ''
                }}
              >
                <option value="">
                  {form.assignedIds.length === 0
                    ? t('admin.projectDetail.kanbanUnassigned')
                    : `+ ${t('admin.projectDetail.kanbanAssignee')}`}
                </option>
                {employees
                  .filter(e => !form.assignedIds.includes(e.id))
                  .map(e => (
                    <option key={e.id} value={e.id}>{e.full_name}</option>
                  ))}
              </select>
            </div>
          </div>

          {/* Room + Due Date */}
          <div className="grid grid-cols-2 gap-3">
            {rooms.length > 0 && (
              <Select
                label={t('admin.projectDetail.kanbanRoom')}
                options={roomOpts}
                value={form.room_id}
                onChange={e => setForm(f => ({ ...f, room_id: e.target.value }))}
              />
            )}
            <Input
              label={t('admin.projectDetail.kanbanDueDate')}
              type="date"
              value={form.due_date}
              onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))}
            />
          </div>

          {/* Area */}
          <Input
            label={t('admin.projectDetail.kanbanRoom')}
            placeholder="e.g. Room 214, Floor 3"
            value={form.area}
            onChange={e => setForm(f => ({ ...f, area: e.target.value }))}
          />

          {/* Color Label */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-2">Color Label</label>
            <div className="flex gap-1.5 items-center overflow-x-auto pb-0.5">
              <button
                onClick={() => setForm(f => ({ ...f, label_color: null }))}
                title="No color"
                className={['w-7 h-7 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all',
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

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">{t('admin.projectDetail.kanbanDescription')}</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder={t('admin.projectDetail.kanbanDescriptionPlaceholder')}
              className="w-full bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none resize-none"
            />
          </div>

          {/* Checklist */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-secondary">{t('admin.projectDetail.kanbanChecklist')}</label>
              {form.checklist.length > 0 && (
                <span className="text-[11px] text-tertiary">{doneCount}/{form.checklist.length}</span>
              )}
            </div>
            <div className="space-y-1.5 mb-2">
              {form.checklist.map((item, i) => (
                <div key={i} className="flex items-center gap-2 group">
                  <button
                    onClick={() => toggleCheckItem(i)}
                    className={['w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center transition-colors',
                      item.done ? 'bg-brand border-brand' : 'border-[var(--border-strong)] bg-transparent',
                    ].join(' ')}
                  >
                    {item.done && (
                      <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3 text-white">
                        <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z"/>
                      </svg>
                    )}
                  </button>
                  <span className={['text-sm flex-1', item.done ? 'line-through text-tertiary' : 'text-primary'].join(' ')}>
                    {item.text}
                  </span>
                  <button
                    onClick={() => removeCheckItem(i)}
                    className="text-tertiary hover:text-danger opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L8 6.586l2.293-2.293a1 1 0 111.414 1.414L9.414 8l2.293 2.293a1 1 0 01-1.414 1.414L8 9.414l-2.293 2.293a1 1 0 01-1.414-1.414L6.586 8 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={checkInput}
                onChange={e => setCheckInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCheckItem() } }}
                placeholder={t('admin.projectDetail.kanbanChecklistPlaceholder')}
                className="flex-1 bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2 border border-[var(--border)] focus:border-brand/50 outline-none"
              />
              <button
                onClick={addCheckItem}
                className="px-3 py-2 text-xs font-medium bg-surface-elevated border border-[var(--border)] text-secondary hover:text-primary rounded-button transition-colors"
              >
                {t('admin.projectDetail.kanbanAdd')}
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">{t('admin.projectDetail.kanbanNotes')}</label>
            <textarea
              rows={3}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder={t('admin.projectDetail.kanbanNotesPlaceholder')}
              className="w-full bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none resize-none"
            />
          </div>

          {/* Photos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-secondary">{t('admin.projectDetail.kanbanPhotos')}</label>
              <PhotoPicker
                onFiles={files => setNewFiles(prev => [...prev, ...files])}
                trigger={open => (
                  <button
                    onClick={open}
                    className="text-xs text-brand hover:text-brand/80 font-medium transition-colors"
                  >
                    {t('admin.projectDetail.kanbanAddPhotos')}
                  </button>
                )}
              />
            </div>
            {loadingPhotos && <p className="text-xs text-tertiary py-2">{t('common.loading')}</p>}
            {!loadingPhotos && allPhotos.length > 0 && (
              <div className="space-y-4">
                {(['before', 'progress', 'after'] as const).map(cat => {
                  const items = photosByCategory[cat]
                  if (items.length === 0) return null
                  const { label, color } = CATEGORY_LABELS[cat]
                  return (
                    <div key={cat}>
                      <p className={`text-[11px] font-semibold uppercase tracking-wide mb-1.5 ${color}`}>{label}</p>
                      <div className="grid grid-cols-2 gap-3">
                        {items.map((item, itemIdx) => (
                          <div key={item.id} className="flex flex-col gap-1">
                            <div className="relative aspect-square rounded-button overflow-hidden bg-surface-elevated">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={item.url}
                                alt={t('admin.projectDetail.kanbanPhotoAlt')}
                                className="w-full h-full object-cover cursor-pointer"
                                onClick={() => {
                                  const catPhotos = items.map(p => ({
                                    url: p.url,
                                    category: p.category,
                                    uploaderName: p.uploaderName ?? null,
                                    createdAt: p.createdAt ?? null,
                                    projectName: null,
                                    taskTitle: task?.title ?? null,
                                  } as LightboxPhoto))
                                  setLightbox({ photos: catPhotos, index: itemIdx })
                                }}
                              />
                              {/* Always-visible action bar */}
                              <div className="absolute inset-x-0 bottom-0 flex justify-between items-center p-1.5 bg-black/60">
                                {!item.isNew && item.photo && (
                                  <>
                                    <a
                                      href={item.url}
                                      download
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={e => e.stopPropagation()}
                                      className="text-white/70 hover:text-white transition-colors"
                                      title={t('admin.projectDetail.kanbanDownloadPhoto')}
                                    >
                                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                                        <path fillRule="evenodd" d="M8 1a.75.75 0 01.75.75v6.19l1.72-1.72a.75.75 0 111.06 1.06L8 10.81 4.47 7.28a.75.75 0 111.06-1.06l1.72 1.72V1.75A.75.75 0 018 1zM2 13.25a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" clipRule="evenodd" />
                                      </svg>
                                    </a>
                                    <button
                                      onClick={() => deletePhoto(item.photo!)}
                                      className="text-danger/80 hover:text-danger transition-colors"
                                      title={t('admin.projectDetail.kanbanDeletePhoto')}
                                    >
                                      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L8 6.586l2.293-2.293a1 1 0 111.414 1.414L8 8l2.293 2.293a1 1 0 01-1.414 1.414L8 9.414l-2.293 2.293a1 1 0 01-1.414-1.414L6.586 8 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                      </svg>
                                    </button>
                                  </>
                                )}
                                {item.isNew && (
                                  <button
                                    onClick={() => setNewFiles(prev => prev.filter((_, i) => `new-${i}` !== item.id))}
                                    className="text-danger/80 hover:text-danger transition-colors ml-auto"
                                  >
                                    <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L8 6.586l2.293-2.293a1 1 0 111.414 1.414L8 8l2.293 2.293a1 1 0 01-1.414 1.414L8 9.414l-2.293 2.293a1 1 0 01-1.414-1.414L6.586 8 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                              {item.isNew && (
                                <div className="absolute top-1 left-1 px-1 py-0.5 bg-brand/80 rounded text-[10px] text-white font-medium">new</div>
                              )}
                            </div>
                            <div className="px-0.5">
                              <p className="text-[11px] font-medium text-secondary truncate">
                                {item.uploaderName ?? 'Unknown'}
                              </p>
                              <p className="text-[10px] text-tertiary">
                                {item.createdAt
                                  ? new Date(item.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                                  : 'Pending upload'}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {!loadingPhotos && allPhotos.length === 0 && (
              <PhotoPicker
                onFiles={files => setNewFiles(prev => [...prev, ...files])}
                trigger={open => (
                  <button
                    onClick={open}
                    className="w-full border-2 border-dashed border-[var(--border)] rounded-card py-6 text-center hover:border-brand/40 transition-colors group"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 mx-auto text-tertiary group-hover:text-brand/60 mb-1">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    <p className="text-xs text-tertiary group-hover:text-secondary transition-colors">{t('admin.projectDetail.kanbanAddPhotos')}</p>
                  </button>
                )}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[var(--border)] flex-shrink-0 space-y-2">
          {saveError && (
            <p className="text-xs text-danger bg-danger/10 px-3 py-2 rounded-button">{saveError}</p>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium border border-[var(--border)] text-secondary hover:text-primary rounded-button transition-colors"
            >
              {t('admin.projectDetail.kanbanCancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={!form.title.trim() || saving || uploading}
              className="flex-1 px-4 py-2.5 text-sm font-medium bg-brand hover:bg-brand/90 text-white rounded-button transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving || uploading ? t('admin.projectDetail.kanbanSaving') : task?.id ? t('admin.projectDetail.kanbanSave') : t('admin.projectDetail.kanbanCreate')}
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  )
}

// ─── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumnView({
  col,
  tasks,
  onAddTask,
  onTaskClick,
  onDragStart,
  onDrop,
  onRename,
  onDelete,
  t,
}: {
  col: KanbanColumn
  tasks: KanbanTask[]
  onAddTask: (colId: string) => void
  onTaskClick: (task: KanbanTask) => void
  onDragStart: (taskId: string) => void
  onDrop: (colId: string) => void
  onRename: (col: KanbanColumn, name: string) => void
  onDelete: (col: KanbanColumn) => void
  t: (key: string) => string
}) {
  const [dragOver, setDragOver] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState(col.name)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div
      className={['flex-1 min-w-[176px] max-w-[240px] flex flex-col rounded-card border transition-colors', dragOver ? 'border-brand/50 bg-brand/5' : 'border-[var(--border)] bg-surface-elevated'].join(' ')}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={() => { setDragOver(false); onDrop(col.id) }}
    >
      {/* Column header */}
      <div className="px-3 py-2.5 flex items-center justify-between border-b border-[var(--border)]">
        {renaming ? (
          <form
            onSubmit={e => { e.preventDefault(); onRename(col, renameVal); setRenaming(false) }}
            className="flex gap-1.5 flex-1 mr-1"
          >
            <input
              autoFocus
              value={renameVal}
              onChange={e => setRenameVal(e.target.value)}
              className="flex-1 text-xs font-semibold bg-surface text-primary px-2 py-1 rounded-button border border-brand/50 outline-none min-w-0"
            />
            <button type="submit" className="text-[11px] text-brand font-medium">{t('admin.projectDetail.kanbanColumnExists')}</button>
          </form>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xs font-semibold text-primary truncate">{col.name}</span>
            <span className="text-[11px] text-tertiary flex-shrink-0">{tasks.length}</span>
          </div>
        )}
        {!renaming && (
          <div className="relative flex-shrink-0" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(m => !m)}
              className="p-1 rounded-button text-tertiary hover:text-secondary transition-colors"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-4 h-4">
                <path d="M3 8a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zm4.5 0a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0zM13 8a1.5 1.5 0 113 0 1.5 1.5 0 01-3 0z"/>
              </svg>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-10 w-36 bg-surface border border-[var(--border)] rounded-card shadow-xl overflow-hidden">
                <button
                  onClick={() => { setRenameVal(col.name); setRenaming(true); setMenuOpen(false) }}
                  className="w-full text-left px-3 py-2 text-xs text-secondary hover:text-primary hover:bg-surface-elevated transition-colors"
                >
                  {t('admin.projectDetail.kanbanRenameColumn')}
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onDelete(col) }}
                  className="w-full text-left px-3 py-2 text-xs text-danger hover:bg-danger/10 transition-colors"
                >
                  {t('admin.projectDetail.kanbanDeleteColumn')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Task cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[80px]">
        {tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            onClick={() => onTaskClick(task)}
            onDragStart={() => onDragStart(task.id)}
          />
        ))}
      </div>

      {/* Add task button */}
      <div className="p-2 border-t border-[var(--border)]">
        <button
          onClick={() => onAddTask(col.id)}
          className="w-full text-left px-2 py-1.5 text-xs text-tertiary hover:text-secondary transition-colors rounded-button hover:bg-surface flex items-center gap-1.5"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" clipRule="evenodd" />
          </svg>
          {t('admin.projectDetail.kanbanAddTask')}
        </button>
      </div>
    </div>
  )
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onClick,
  onDragStart,
}: {
  task: KanbanTask
  onClick: () => void
  onDragStart: () => void
}) {
  const doneCount = task.checklist?.filter(c => c.done).length ?? 0
  const totalCount = task.checklist?.length ?? 0

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={[
        'rounded-button border border-[var(--border)] p-3 cursor-pointer hover:border-[var(--border-strong)] transition-all active:opacity-70 select-none overflow-hidden',
        task.label_color ? '' : 'bg-surface hover:bg-surface/80',
      ].join(' ')}
      style={task.label_color ? {
        backgroundColor: task.label_color + '18',
        borderLeftColor: task.label_color,
        borderLeftWidth: '3px',
      } : undefined}
    >
      {/* Priority dot + title */}
      <div className="flex items-start gap-2">
        <span
          className={['w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5', task.label_color ? '' : (PRIORITY_DOT[task.priority] ?? 'bg-tertiary')].join(' ')}
          style={task.label_color ? { backgroundColor: task.label_color } : undefined}
        />
        <p className="text-xs font-medium text-primary leading-snug line-clamp-3 flex-1">{task.title}</p>
      </div>

      {/* Meta row */}
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {task.area && (
          <span className="text-[11px] text-tertiary bg-surface-elevated px-1.5 py-0.5 rounded">{task.area}</span>
        )}
        {task.assigned_employee?.full_name && (
          <span className="text-[11px] text-secondary truncate max-w-[120px]">
            {task.assigned_employee.full_name.split(' ')[0]}
          </span>
        )}
        {totalCount > 0 && (
          <span className="text-[11px] text-tertiary ml-auto">{doneCount}/{totalCount}</span>
        )}
      </div>
    </div>
  )
}

// ─── Main KanbanBoard ─────────────────────────────────────────────────────────

export function KanbanBoard({
  projectId,
  companyId,
  employees,
}: {
  projectId: string
  companyId: string
  employees: Profile[]
}) {
  const { t } = useTranslation()
  useOfflinePhotoSync(companyId)
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [tasks, setTasks] = useState<KanbanTask[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)

  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [drawerTask, setDrawerTask] = useState<KanbanTask | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [_newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null)

  const [addingColumn, setAddingColumn] = useState(false)
  const [newColumnName, setNewColumnName] = useState('')
  const [savingColumn, setSavingColumn] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const [{ data: cols }, { data: tkns }, { data: rms }] = await Promise.all([
      supabase.from('task_columns').select('*').eq('project_id', projectId).order('position'),
      supabase.from('tasks').select('*, assigned_employee:assigned_to(full_name)').eq('project_id', projectId).order('created_at', { ascending: true }),
      supabase.from('project_rooms').select('id, label, floor').eq('company_id', companyId),
    ])
    setColumns((cols ?? []) as KanbanColumn[])
    setTasks((tkns ?? []) as unknown as KanbanTask[])
    setRooms((rms ?? []) as Room[])
    setLoading(false)
  }, [projectId, companyId])

  useEffect(() => { load() }, [load])

  async function addColumn() {
    const name = newColumnName.trim()
    if (!name) return
    setSavingColumn(true)
    const supabase = createClient()
    const position = columns.length
    const { data } = await supabase
      .from('task_columns')
      .insert({ project_id: projectId, company_id: companyId, name, position })
      .select()
      .single()
    if (data) setColumns(prev => [...prev, data as KanbanColumn])
    setNewColumnName('')
    setAddingColumn(false)
    setSavingColumn(false)
  }

  async function renameColumn(col: KanbanColumn, name: string) {
    const trimmed = name.trim()
    if (!trimmed || trimmed === col.name) return
    const supabase = createClient()
    writeFailed((await supabase.from('task_columns').update({ name: trimmed }).eq('id', col.id)).error, 'save your changes')
    setColumns(prev => prev.map(c => c.id === col.id ? { ...c, name: trimmed } : c))
  }

  async function deleteColumn(col: KanbanColumn) {
    if (!window.confirm(t('admin.projectDetail.kanbanDeleteColumnConfirm'))) return
    const supabase = createClient()
    writeFailed((await supabase.from('task_columns').delete().eq('id', col.id)).error, 'delete this item')
    setColumns(prev => prev.filter(c => c.id !== col.id))
    setTasks(prev => prev.map(tk => tk.column_id === col.id ? { ...tk, column_id: null } : tk))
  }

  async function moveTask(taskId: string, colId: string) {
    if (!taskId) return
    const supabase = createClient()
    writeFailed((await supabase.from('tasks').update({ column_id: colId }).eq('id', taskId)).error, 'save your changes')
    setTasks(prev => prev.map(tk => tk.id === taskId ? { ...tk, column_id: colId } : tk))
  }

  function openNewTask(colId: string) {
    setNewTaskColumnId(colId)
    setDrawerTask({ id: '', title: '', description: null, area: null, priority: 'medium', status: 'pending', due_date: null, notes: null, checklist: [], assigned_to: null, column_id: colId, room_id: null, label_color: null, created_at: '' })
    setDrawerOpen(true)
  }

  function openEditTask(task: KanbanTask) {
    setNewTaskColumnId(null)
    setDrawerTask(task)
    setDrawerOpen(true)
  }

  function handleTaskUpdated(updated: KanbanTask) {
    setTasks(prev => {
      const idx = prev.findIndex(t => t.id === updated.id)
      if (idx >= 0) return prev.map(t => t.id === updated.id ? updated : t)
      return [...prev, updated]
    })
    setDrawerOpen(false)
    setDrawerTask(null)
  }

  function handleTaskDeleted(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id))
    setDrawerOpen(false)
    setDrawerTask(null)
  }

  if (loading) {
    return <p className="text-sm text-secondary text-center py-8">{t('admin.projectDetail.loadingTasks')}</p>
  }

  const uncolumnedTasks = tasks.filter(tk => !tk.column_id)

  return (
    <div>
      {/* Board header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-tertiary">{t('admin.projectDetail.kanbanDragHint')}</p>
        {!addingColumn && (
          <button
            onClick={() => setAddingColumn(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-secondary hover:text-primary px-3 py-1.5 rounded-button border border-[var(--border)] hover:border-[var(--border-strong)] bg-surface-elevated transition-colors"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" clipRule="evenodd" />
            </svg>
            {t('admin.projectDetail.kanbanAddColumn')}
          </button>
        )}
      </div>

      {/* No columns empty state */}
      {columns.length === 0 && !addingColumn && (
        <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed border-[var(--border)] rounded-card">
          <div className="w-12 h-12 rounded-full bg-brand/10 flex items-center justify-center mb-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6 text-brand">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v15m6-15v15M3.75 9h16.5M3.75 15h16.5" />
            </svg>
          </div>
          <p className="text-sm font-medium text-primary mb-1">{t('admin.projectDetail.kanbanNoColumns')}</p>
          <p className="text-xs text-tertiary mb-4">{t('admin.projectDetail.kanbanNoColumnsHint')}</p>
          <button
            onClick={() => setAddingColumn(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-white bg-brand hover:bg-brand/90 px-4 py-2 rounded-button transition-colors"
          >
            {t('admin.projectDetail.kanbanAddColumn')}
          </button>
        </div>
      )}

      {/* Horizontal scroll container */}
      {(columns.length > 0 || addingColumn) && (
        <div className="overflow-x-auto pb-4 -mx-1">
          <div className="flex gap-3 px-1 w-full">
            {columns.map(col => (
              <KanbanColumnView
                key={col.id}
                col={col}
                tasks={tasks.filter(tk => tk.column_id === col.id)}
                onAddTask={openNewTask}
                onTaskClick={openEditTask}
                onDragStart={id => setDraggingTaskId(id)}
                onDrop={colId => { if (draggingTaskId) moveTask(draggingTaskId, colId) }}
                onRename={renameColumn}
                onDelete={deleteColumn}
                t={t}
              />
            ))}

            {/* Add column form */}
            {addingColumn && (
              <div className="flex-1 min-w-[176px] max-w-[240px] flex flex-col gap-2 p-3 border border-dashed border-[var(--border-strong)] rounded-card bg-surface-elevated">
                <p className="text-xs font-semibold text-secondary">{t('admin.projectDetail.kanbanColumnName')}</p>
                <input
                  autoFocus
                  value={newColumnName}
                  onChange={e => setNewColumnName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addColumn(); if (e.key === 'Escape') { setAddingColumn(false); setNewColumnName('') } }}
                  placeholder={t('admin.projectDetail.kanbanColumnPlaceholder')}
                  className="bg-surface text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2 border border-[var(--border)] focus:border-brand/50 outline-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setAddingColumn(false); setNewColumnName('') }}
                    className="flex-1 py-1.5 text-xs text-secondary border border-[var(--border)] rounded-button hover:text-primary transition-colors"
                  >
                    {t('admin.projectDetail.kanbanCancel')}
                  </button>
                  <button
                    onClick={addColumn}
                    disabled={!newColumnName.trim() || savingColumn}
                    className="flex-1 py-1.5 text-xs font-medium text-white bg-brand rounded-button hover:bg-brand/90 disabled:opacity-50 transition-colors"
                  >
                    {t('admin.projectDetail.kanbanColumnExists')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Uncolumned tasks (tasks not assigned to any column) */}
      {uncolumnedTasks.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-medium text-tertiary mb-2 uppercase tracking-wide">Unassigned</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {uncolumnedTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => openEditTask(task)}
                onDragStart={() => {}}
              />
            ))}
          </div>
        </div>
      )}

      {/* Add task button when there are columns but user hasn't picked one */}
      {columns.length > 0 && (
        <div className="mt-4 flex justify-center">
          <Badge variant="gray">
            <span className="text-xs">{tasks.length} tasks total</span>
          </Badge>
        </div>
      )}

      {/* Task Drawer */}
      {drawerOpen && drawerTask !== null && (
        <TaskDrawer
          task={drawerTask}
          isNew={!drawerTask.id}
          projectId={projectId}
          companyId={companyId}
          employees={employees}
          rooms={rooms}
          columns={columns}
          onClose={() => { setDrawerOpen(false); setDrawerTask(null) }}
          onUpdated={handleTaskUpdated}
          onDeleted={handleTaskDeleted}
        />
      )}
    </div>
  )
}
