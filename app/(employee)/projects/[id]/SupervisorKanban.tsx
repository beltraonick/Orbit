'use client'

import { writeFailed } from '@/lib/write-feedback'
import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { useCompanyId } from '@/lib/company-context'
import { PhotoPicker } from '@/components/ui/PhotoPicker'
import { PhotoLightbox, type LightboxPhoto } from '@/components/ui/PhotoLightbox'
import { updateSupervisorTask, createSupervisorTask } from '@/app/actions/employeeTasks'
import { TeamClockIn } from './TeamClockIn'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function taskPhotoUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/task-photos/${path}`
}

interface KanbanColumn { id: string; name: string; position: number }
interface ChecklistItem { text: string; done: boolean }

interface SupervisorTask {
  id: string
  title: string
  status: string
  area: string | null
  priority: string
  due_date: string | null
  notes: string | null
  checklist: ChecklistItem[]
  assigned_to: string | null
  column_id: string | null
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

const PRIORITY_DOT: Record<string, string> = {
  low: 'bg-blue', medium: 'bg-amber', high: 'bg-danger/70', urgent: 'bg-danger',
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskCard({ task, onClick, onDragStart }: {
  task: SupervisorTask
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
      <div className="flex items-start gap-2">
        <span
          className={['w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5', task.label_color ? '' : (PRIORITY_DOT[task.priority] ?? 'bg-tertiary')].join(' ')}
          style={task.label_color ? { backgroundColor: task.label_color } : undefined}
        />
        <p className="text-xs font-medium text-primary leading-snug line-clamp-3 flex-1">{task.title}</p>
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {task.area && <span className="text-[11px] text-tertiary bg-surface-elevated px-1.5 py-0.5 rounded">{task.area}</span>}
        {task.assigned_employee?.full_name && (
          <span className="text-[11px] text-secondary truncate max-w-[120px]">
            {task.assigned_employee.full_name.split(' ')[0]}
          </span>
        )}
        {totalCount > 0 && <span className="text-[11px] text-tertiary ml-auto">{doneCount}/{totalCount}</span>}
      </div>
    </div>
  )
}

// ─── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumnView({ col, tasks, onTaskClick, onDragStart, onDrop, onAddTask }: {
  col: KanbanColumn
  tasks: SupervisorTask[]
  onTaskClick: (task: SupervisorTask) => void
  onDragStart: (taskId: string) => void
  onDrop: (colId: string) => void
  onAddTask: (colId: string) => void
}) {
  const [dragOver, setDragOver] = useState(false)

  return (
    <div
      className={[
        'flex-shrink-0 w-64 flex flex-col rounded-card border transition-colors',
        dragOver ? 'border-brand/50 bg-brand/5' : 'border-[var(--border)] bg-surface-elevated',
      ].join(' ')}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={() => { setDragOver(false); onDrop(col.id) }}
    >
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-[var(--border)]">
        <span className="text-xs font-semibold text-primary truncate flex-1">{col.name}</span>
        <span className="text-[11px] text-tertiary flex-shrink-0">{tasks.length}</span>
      </div>
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
      <button
        onClick={() => onAddTask(col.id)}
        className="flex items-center gap-1.5 px-3 py-2 text-xs text-tertiary hover:text-brand hover:bg-brand/5 transition-colors border-t border-[var(--border)] rounded-b-card"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
          <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
        Add task
      </button>
    </div>
  )
}

// ─── Supervisor Task Drawer ───────────────────────────────────────────────────

function SupervisorDrawer({ task, projectId, companyId, profileName, onClose, onUpdated }: {
  task: SupervisorTask
  projectId: string
  companyId: string
  profileName: string
  onClose: () => void
  onUpdated: (t: SupervisorTask) => void
}) {
  const { t } = useTranslation()
  const [editTitle, setEditTitle] = useState(task.title)
  const [editStatus, setEditStatus] = useState(task.status)
  const [editChecklist, setEditChecklist] = useState<ChecklistItem[]>(task.checklist ?? [])
  const [editNotes, setEditNotes] = useState(task.notes ?? '')
  const [checkInput, setCheckInput] = useState('')
  const [photos, setPhotos] = useState<TaskPhoto[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(true)
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('task_media')
      .select('id, storage_path, photo_category, uploaded_by_name, created_at')
      .eq('task_id', task.id)
      .order('created_at')
      .then(({ data }) => {
        setPhotos((data ?? []) as TaskPhoto[])
        setLoadingPhotos(false)
      })
  }, [task.id])

  const STATUS_OPTS = [
    { value: 'pending', label: t('common.pending') },
    { value: 'in_progress', label: t('common.inProgress') },
    { value: 'completed', label: t('common.completed') },
  ]

  function addCheckItem() {
    const text = checkInput.trim()
    if (!text) return
    setEditChecklist(prev => [...prev, { text, done: false }])
    setCheckInput('')
  }

  async function handleSave() {
    setSaving(true)
    setSaveError(null)

    const result = await updateSupervisorTask(task.id, {
      title: editTitle,
      status: editStatus,
      checklist: editChecklist,
      notes: editNotes,
    })

    if (result.error) {
      setSaveError(result.error)
      setSaving(false)
      return
    }

    if (newFiles.length > 0) {
      setUploading(true)
      const supabase = createClient()
      for (const file of newFiles) {
        const ext = file.name.split('.').pop() ?? 'jpg'
        const path = `${companyId}/${task.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { error } = await supabase.storage.from('task-photos').upload(path, file, { contentType: file.type })
        if (!error) {
          writeFailed((await supabase.from('task_media').insert({
            task_id: task.id,
            project_id: projectId,
            company_id: companyId,
            media_type: 'photo',
            storage_path: path,
            photo_category: 'progress',
            uploaded_by_name: profileName,
          })).error, 'save your changes')
        } else writeFailed(error, `upload ${file.name}`)
      }
      const { data: updatedPhotos } = await supabase
        .from('task_media')
        .select('id, storage_path, photo_category, uploaded_by_name, created_at')
        .eq('task_id', task.id)
        .order('created_at')
      setPhotos((updatedPhotos ?? []) as TaskPhoto[])
      setUploading(false)
      setNewFiles([])
    }

    onUpdated({
      ...task,
      title: editTitle,
      status: editStatus,
      checklist: editChecklist,
      notes: editNotes || null,
    })
    setSaving(false)
  }

  const allPhotos = [
    ...photos.map(p => ({
      id: p.id,
      url: taskPhotoUrl(p.storage_path),
      isNew: false,
      uploaderName: p.uploaded_by_name,
      createdAt: p.created_at,
    })),
    ...newFiles.map((f, i) => ({
      id: `new-${i}`,
      url: URL.createObjectURL(f),
      isNew: true,
      uploaderName: profileName,
      createdAt: null,
    })),
  ]

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-surface border-l border-[var(--border)] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <h2 className="text-sm font-semibold text-primary truncate flex-1 mr-3">
            {t('admin.projectDetail.kanbanEditTask')}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-button flex items-center justify-center text-secondary hover:text-primary hover:bg-surface-elevated transition-colors flex-shrink-0"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-1">
              {t('admin.projectDetail.kanbanTaskTitle')}
            </label>
            <textarea
              rows={2}
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              className="w-full bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none resize-none"
            />
          </div>

          {/* Read-only meta chips */}
          {(task.area || task.due_date || task.assigned_employee?.full_name) && (
            <div className="flex flex-wrap gap-1.5">
              {task.area && (
                <span className="text-xs bg-surface-elevated text-secondary px-2 py-1 rounded border border-[var(--border)]">
                  {task.area}
                </span>
              )}
              {task.due_date && (
                <span className="text-xs bg-surface-elevated text-secondary px-2 py-1 rounded border border-[var(--border)]">
                  {new Date(task.due_date).toLocaleDateString()}
                </span>
              )}
              {task.assigned_employee?.full_name && (
                <span className="text-xs bg-surface-elevated text-secondary px-2 py-1 rounded border border-[var(--border)]">
                  {task.assigned_employee.full_name.split(' ')[0]}
                </span>
              )}
            </div>
          )}

          {/* Status pills */}
          <div>
            <label className="block text-xs font-medium text-secondary mb-2">
              {t('admin.projectDetail.kanbanStatus')}
            </label>
            <div className="flex gap-2">
              {STATUS_OPTS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setEditStatus(opt.value)}
                  className={[
                    'flex-1 py-2 text-xs font-medium rounded-button border transition-colors',
                    editStatus === opt.value
                      ? 'bg-brand text-white border-brand'
                      : 'border-[var(--border)] text-secondary hover:text-primary bg-surface-elevated',
                  ].join(' ')}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Checklist */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-secondary">
                {t('admin.projectDetail.kanbanChecklist')}
              </label>
              {editChecklist.length > 0 && (
                <span className="text-[11px] text-tertiary">
                  {editChecklist.filter(c => c.done).length}/{editChecklist.length}
                </span>
              )}
            </div>
            <div className="space-y-1.5 mb-2">
              {editChecklist.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <button
                    onClick={() => setEditChecklist(prev =>
                      prev.map((c, idx) => idx === i ? { ...c, done: !c.done } : c)
                    )}
                    className={[
                      'w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center transition-colors',
                      item.done ? 'bg-brand border-brand' : 'border-[var(--border-strong)] bg-transparent',
                    ].join(' ')}
                  >
                    {item.done && (
                      <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3 text-white">
                        <path d="M10.28 2.28L3.989 8.575 1.695 6.28A1 1 0 00.28 7.695l3 3a1 1 0 001.414 0l7-7A1 1 0 0010.28 2.28z" />
                      </svg>
                    )}
                  </button>
                  <span className={['text-sm flex-1', item.done ? 'line-through text-tertiary' : 'text-primary'].join(' ')}>
                    {item.text}
                  </span>
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
            <label className="block text-xs font-medium text-secondary mb-1">
              {t('admin.projectDetail.kanbanNotes')}
            </label>
            <textarea
              rows={3}
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
              placeholder={t('admin.projectDetail.kanbanNotesPlaceholder')}
              className="w-full bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none resize-none"
            />
          </div>

          {/* Photos */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-secondary">
                {t('admin.projectDetail.kanbanPhotos')}
              </label>
              <PhotoPicker
                onFiles={files => setNewFiles(prev => [...prev, ...files])}
                trigger={open => (
                  <button onClick={open} className="text-xs text-brand hover:text-brand/80 font-medium transition-colors">
                    {t('admin.projectDetail.kanbanAddPhotos')}
                  </button>
                )}
              />
            </div>
            {loadingPhotos && <p className="text-xs text-tertiary py-2">{t('common.loading')}</p>}
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
                    <p className="text-xs text-tertiary group-hover:text-secondary transition-colors">
                      {t('admin.projectDetail.kanbanAddPhotos')}
                    </p>
                  </button>
                )}
              />
            )}
            {!loadingPhotos && allPhotos.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {allPhotos.map((item, idx) => (
                  <div key={item.id} className="flex flex-col gap-1">
                    <div className="relative aspect-square rounded-button overflow-hidden bg-surface-elevated">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.url}
                        alt="photo"
                        className="w-full h-full object-cover cursor-pointer"
                        onClick={() => {
                          const lbPhotos = allPhotos.map(p => ({
                            url: p.url,
                            category: 'progress',
                            uploaderName: p.uploaderName ?? null,
                            createdAt: p.createdAt ?? null,
                            projectName: null,
                            taskTitle: task.title,
                          } as LightboxPhoto))
                          setLightbox({ photos: lbPhotos, index: idx })
                        }}
                      />
                      {item.isNew && (
                        <div className="absolute top-1 left-1 px-1 py-0.5 bg-brand/80 rounded text-[10px] text-white font-medium">
                          new
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] text-tertiary px-0.5 truncate">
                      {item.uploaderName ?? '—'}
                    </p>
                  </div>
                ))}
              </div>
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
              disabled={!editTitle.trim() || saving || uploading}
              className="flex-1 px-4 py-2.5 text-sm font-medium bg-brand hover:bg-brand/90 text-white rounded-button transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving || uploading
                ? t('admin.projectDetail.kanbanSaving')
                : t('admin.projectDetail.kanbanSave')}
            </button>
          </div>
        </div>
      </div>

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

// ─── Main SupervisorKanban ────────────────────────────────────────────────────

export function SupervisorKanban({
  projectId,
  profileName,
}: {
  projectId: string
  profileName: string
}) {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const [columns, setColumns] = useState<KanbanColumn[]>([])
  const [tasks, setTasks] = useState<SupervisorTask[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'kanban' | 'team'>('kanban')
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null)
  const [drawerTask, setDrawerTask] = useState<SupervisorTask | null>(null)
  const [addingToCol, setAddingToCol] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [addingBusy, setAddingBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const [{ data: cols }, { data: tkns }] = await Promise.all([
      supabase.from('task_columns').select('*').eq('project_id', projectId).order('position'),
      supabase.from('tasks')
        .select('*, assigned_employee:assigned_to(full_name)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true }),
    ])
    setColumns((cols ?? []) as KanbanColumn[])
    setTasks((tkns ?? []) as unknown as SupervisorTask[])
    setLoading(false)
  }, [projectId])

  useEffect(() => { load() }, [load])

  async function moveTask(taskId: string, colId: string) {
    const supabase = createClient()
    writeFailed((await supabase.from('tasks').update({ column_id: colId }).eq('id', taskId)).error, 'save your changes')
    setTasks(prev => prev.map(tk => tk.id === taskId ? { ...tk, column_id: colId } : tk))
  }

  function handleTaskUpdated(updated: SupervisorTask) {
    setTasks(prev => prev.map(tk => tk.id === updated.id ? updated : tk))
    setDrawerTask(null)
  }

  function openAddTask(colId: string) {
    setAddingToCol(colId)
    setNewTaskTitle('')
  }

  async function submitAddTask() {
    const title = newTaskTitle.trim()
    if (!title || !addingToCol) return
    setAddingBusy(true)
    const result = await createSupervisorTask(projectId, addingToCol, title)
    if (result.ok && result.task) {
      setTasks(prev => [...prev, result.task as SupervisorTask])
    }
    setAddingToCol(null)
    setNewTaskTitle('')
    setAddingBusy(false)
  }

  const uncolumnedTasks = tasks.filter(tk => !tk.column_id)

  if (loading) {
    return (
      <p className="text-sm text-secondary text-center py-8">
        {t('admin.projectDetail.loadingTasks')}
      </p>
    )
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-[var(--border)] px-4 mb-4">
        <button
          onClick={() => setActiveTab('kanban')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'kanban'
              ? 'border-brand text-primary'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
        >
          {t('supervisor.tabs.tasks')}
        </button>
        <button
          onClick={() => setActiveTab('team')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'team'
              ? 'border-brand text-primary'
              : 'border-transparent text-secondary hover:text-primary'
          }`}
        >
          {t('supervisor.tabs.teamClock')}
        </button>
      </div>

      {/* Team clock-in tab */}
      {activeTab === 'team' && (
        <TeamClockIn projectId={projectId} />
      )}

      {/* Kanban tab */}
      {activeTab === 'kanban' && <>
      {/* Kanban board */}
      {columns.length > 0 && (
        <div className="overflow-x-auto pb-4 -mx-4 px-4">
          <div className="flex gap-3" style={{ minWidth: 'max-content' }}>
            {columns.map(col => (
              <KanbanColumnView
                key={col.id}
                col={col}
                tasks={tasks.filter(tk => tk.column_id === col.id)}
                onTaskClick={setDrawerTask}
                onDragStart={id => setDraggingTaskId(id)}
                onDrop={colId => { if (draggingTaskId) moveTask(draggingTaskId, colId) }}
                onAddTask={openAddTask}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {columns.length === 0 && tasks.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-[var(--border)] rounded-card">
          <p className="text-sm font-medium text-primary mb-1">
            Nenhuma tarefa ainda
          </p>
          <p className="text-xs text-tertiary">
            As tarefas aparecerão aqui quando o admin as criar.
          </p>
        </div>
      )}

      {/* Uncolumned tasks */}
      {uncolumnedTasks.length > 0 && (
        <div className={columns.length > 0 ? 'mt-6' : ''}>
          {columns.length > 0 && (
            <p className="text-xs font-medium text-tertiary mb-2 uppercase tracking-wide">
              Sem coluna
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {uncolumnedTasks.map(task => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => setDrawerTask(task)}
                onDragStart={() => {}}
              />
            ))}
          </div>
        </div>
      )}

      {/* Drawer */}
      {drawerTask && (
        <SupervisorDrawer
          task={drawerTask}
          projectId={projectId}
          companyId={companyId}
          profileName={profileName}
          onClose={() => setDrawerTask(null)}
          onUpdated={handleTaskUpdated}
        />
      )}

      {/* Add task modal */}
      {addingToCol && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setAddingToCol(null)}
        >
          <div
            className="bg-surface w-full max-w-lg rounded-t-card border-t border-l border-r border-[var(--border)] px-5 py-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center mb-4">
              <div className="w-10 h-1 rounded-full bg-tertiary/40" />
            </div>
            <p className="text-sm font-semibold text-primary mb-3">Nova tarefa</p>
            <input
              autoFocus
              type="text"
              value={newTaskTitle}
              onChange={e => setNewTaskTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitAddTask() }}
              placeholder="Título da tarefa…"
              className="w-full bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none mb-3"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setAddingToCol(null)}
                className="flex-1 h-10 rounded-button border border-[var(--border)] text-sm text-secondary hover:text-primary transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={submitAddTask}
                disabled={!newTaskTitle.trim() || addingBusy}
                className="flex-1 h-10 rounded-button bg-brand text-white text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-50"
              >
                {addingBusy ? '…' : 'Adicionar'}
              </button>
            </div>
            <div className="safe-bottom" />
          </div>
        </div>
      )}
      </>}
    </div>
  )
}
