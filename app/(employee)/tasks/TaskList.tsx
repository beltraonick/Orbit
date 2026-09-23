'use client'

import { writeFailed } from '@/lib/write-feedback'
import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { queueIfOffline } from '@/lib/offline-queue'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { PhotoPicker } from '@/components/ui/PhotoPicker'
import { PhotoLightbox, type LightboxPhoto } from '@/components/ui/PhotoLightbox'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function taskPhotoUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/task-photos/${path}`
}

async function compressImage(file: File): Promise<Blob> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const MAX = 1200
      let w = img.width, h = img.height
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX }
        else { w = Math.round(w * MAX / h); h = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => resolve(blob!), 'image/jpeg', 0.85)
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(file)
  })
}

interface ChecklistItem { text: string; done: boolean }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Task = Record<string, any> & { id: string; title: string; status: string }

interface PhotoRow {
  storage_path: string
  uploaded_by_name?: string | null
  created_at?: string | null
  employee_id?: string | null
}

interface PendingPhoto {
  id: string
  file: File
  category: 'before' | 'after'
  localUrl: string
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-danger',
  high: 'bg-danger/60',
  medium: 'bg-amber',
  low: 'bg-blue',
}

const ACCENT_PALETTE = [
  { textCls: 'text-blue',   headerBgCls: 'bg-blue/10',   borderColor: 'rgb(var(--color-blue))' },
  { textCls: 'text-green',  headerBgCls: 'bg-green/10',  borderColor: 'rgb(var(--color-green))' },
  { textCls: 'text-amber',  headerBgCls: 'bg-amber/10',  borderColor: 'rgb(var(--color-amber))' },
  { textCls: 'text-brand',  headerBgCls: 'bg-brand/10',  borderColor: 'rgb(var(--color-brand))' },
  { textCls: 'text-danger', headerBgCls: 'bg-danger/10', borderColor: 'rgb(var(--color-danger))' },
]

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
    </svg>
  )
}

function WifiOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <line x1="2" y1="2" x2="22" y2="22" />
      <path strokeLinecap="round" d="M8.5 16.5a5 5 0 017 0" />
      <path strokeLinecap="round" d="M5 12.5a9 9 0 0110.56-1.55M2.35 9A14 14 0 0116 7" />
      <path strokeLinecap="round" d="M1 6C3.6 4.17 6.76 3 10.2 3" />
      <circle cx="12" cy="20" r="1" fill="currentColor" />
    </svg>
  )
}

function SpinIcon({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
    </svg>
  )
}

export function TaskList({
  tasks: initial,
  profileId,
  employeeName,
  supabaseReady,
  canDeleteTeamPhotos,
}: {
  tasks: Task[]
  profileId: string | null
  employeeName: string
  supabaseReady: boolean
  canDeleteTeamPhotos?: boolean
}) {
  const companyId = useCompanyId()
  const { t } = useTranslation()
  const router = useRouter()

  // Core state
  const [tasks, setTasks] = useState(initial)
  const [selected, setSelected] = useState<Task | null>(null)
  const [liveStatus, setLiveStatus] = useState<string>('pending')
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState('')

  // Photo state
  const [beforePhotos, setBeforePhotos] = useState<PhotoRow[]>([])
  const [afterPhotos, setAfterPhotos] = useState<PhotoRow[]>([])
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([])
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number; category: 'before' | 'after' } | null>(null)
  const [loadingPhotos, setLoadingPhotos] = useState(false)

  // Lightbox state (includes source rows for delete)
  const [lightbox, setLightbox] = useState<{
    photos: LightboxPhoto[]
    index: number
    sourcePhotos: PhotoRow[]
    category: 'before' | 'after'
  } | null>(null)

  // Undo-delete state
  interface PendingDelete {
    storagePath: string
    taskId: string
    category: 'before' | 'after'
    photo: PhotoRow
    timer: ReturnType<typeof setTimeout>
  }
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const pendingDeleteRef = useRef<PendingDelete | null>(null)

  // Refs for stable closures in async callbacks
  const selectedRef = useRef<Task | null>(null)
  const liveStatusRef = useRef<string>('pending')
  const pendingRef = useRef<PendingPhoto[]>([])
  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { liveStatusRef.current = liveStatus }, [liveStatus])
  useEffect(() => { pendingRef.current = pendingPhotos }, [pendingPhotos])

  // Single photo upload — uses refs so it stays stable
  const doUpload = useCallback(async (file: File, category: 'before' | 'after'): Promise<boolean> => {
    const task = selectedRef.current
    if (!task || !supabaseReady) return false
    try {
      const blob = await compressImage(file)
      const path = `${task.id}/${category}-${Date.now()}.jpg`
      const supabase = createClient()
      const { data: uploaded, error } = await supabase.storage
        .from('task-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (error) throw error

      const photoRow: PhotoRow = {
        storage_path: uploaded.path,
        uploaded_by_name: employeeName,
        created_at: new Date().toISOString(),
        employee_id: profileId,
      }

      const mediaRow = {
        task_id: task.id,
        project_id: task.project_id ?? null,
        company_id: companyId,
        employee_id: profileId,
        media_type: 'photo',
        storage_path: uploaded.path,
        photo_category: category,
        uploaded_by_name: employeeName,
      }
      const { error: dbError } = await supabase.from('task_media').insert(mediaRow)
      if (dbError) {
        const { uploaded_by_name: _n, ...coreRow } = mediaRow
        const { error: retryError } = await supabase.from('task_media').insert(coreRow)
        if (retryError) throw new Error(retryError.message)
      }

      if (category === 'before') {
        setBeforePhotos(prev => [...prev, photoRow])
        if (liveStatusRef.current === 'pending') {
          const { error: se } = await supabase.from('tasks').update({
            status: 'in_progress',
            updated_at: new Date().toISOString(),
          }).eq('id', task.id)
          if (!se) {
            setLiveStatus('in_progress')
            setTasks(prev => prev.map(tk => tk.id === task.id ? { ...tk, status: 'in_progress' } : tk))
          }
        }
      } else {
        setAfterPhotos(prev => [...prev, photoRow])
      }
      return true
    } catch {
      return false
    }
  }, [supabaseReady, companyId, profileId, employeeName])

  // Flush pending photos when back online
  useEffect(() => {
    function onOnline() {
      const pending = [...pendingRef.current]
      if (pending.length === 0) return
      setPendingPhotos([])
      ;(async () => {
        for (const item of pending) {
          await doUpload(item.file, item.category)
          URL.revokeObjectURL(item.localUrl)
        }
      })()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [doUpload])

  // Handle new files from PhotoPicker
  const handlePhotos = useCallback(async (files: File[], category: 'before' | 'after') => {
    if (!selectedRef.current || !supabaseReady) return

    if (!navigator.onLine) {
      const newPending: PendingPhoto[] = files.map(file => ({
        id: `${Date.now()}-${Math.random()}`,
        file,
        category,
        localUrl: URL.createObjectURL(file),
      }))
      setPendingPhotos(prev => [...prev, ...newPending])
      return
    }

    setUploadProgress({ done: 0, total: files.length, category })
    for (let i = 0; i < files.length; i++) {
      await doUpload(files[i], category)
      setUploadProgress({ done: i + 1, total: files.length, category })
    }
    setUploadProgress(null)
  }, [supabaseReady, doUpload])

  // Execute the actual DB/storage delete (used after undo window expires)
  const execDelete = useCallback(async (storagePath: string, taskId: string) => {
    const supabase = createClient()
    const [, { error }] = await Promise.all([
      supabase.storage.from('task-photos').remove([storagePath]),
      supabase.from('task_media').delete().eq('task_id', taskId).eq('storage_path', storagePath),
    ])
    writeFailed(error, 'delete this photo')
  }, [])

  // Delete with confirmation → undo toast (5s window before actual DB delete)
  const handleDelete = useCallback((photo: PhotoRow, category: 'before' | 'after') => {
    const task = selectedRef.current
    if (!task || !supabaseReady) return
    if (!canDeleteTeamPhotos && photo.employee_id !== profileId) return
    if (!window.confirm('Apagar esta foto?')) return

    // Flush any existing pending delete immediately
    if (pendingDeleteRef.current) {
      const prev = pendingDeleteRef.current
      clearTimeout(prev.timer)
      pendingDeleteRef.current = null
      setPendingDelete(null)
      execDelete(prev.storagePath, prev.taskId)
    }

    // Remove from UI instantly
    if (category === 'before') {
      setBeforePhotos(prev => prev.filter(p => p.storage_path !== photo.storage_path))
    } else {
      setAfterPhotos(prev => prev.filter(p => p.storage_path !== photo.storage_path))
    }

    // Schedule actual delete after 5 seconds
    const taskId = task.id
    const timer = setTimeout(() => {
      pendingDeleteRef.current = null
      setPendingDelete(null)
      execDelete(photo.storage_path, taskId)
    }, 5000)

    const pd: PendingDelete = { storagePath: photo.storage_path, taskId, category, photo, timer }
    pendingDeleteRef.current = pd
    setPendingDelete(pd)
  }, [supabaseReady, execDelete, canDeleteTeamPhotos, profileId])

  // Undo the pending delete
  function undoDelete() {
    const pd = pendingDeleteRef.current
    if (!pd) return
    clearTimeout(pd.timer)
    pendingDeleteRef.current = null
    setPendingDelete(null)
    if (pd.category === 'before') setBeforePhotos(prev => [pd.photo, ...prev])
    else setAfterPhotos(prev => [pd.photo, ...prev])
  }

  // A photo can be deleted by whoever uploaded it, or by a supervisor
  // with the delete_team_photos permission.
  function canDeletePhoto(photo: PhotoRow): boolean {
    return !!canDeleteTeamPhotos || (!!profileId && photo.employee_id === profileId)
  }

  // Open lightbox for a category's photos
  function openLightbox(photos: PhotoRow[], startIndex: number, category: 'before' | 'after') {
    const lbPhotos: LightboxPhoto[] = photos.map(p => ({
      url: taskPhotoUrl(p.storage_path),
      category,
      uploaderName: p.uploaded_by_name ?? null,
      createdAt: p.created_at ?? null,
      projectName: selected?.project?.name ?? null,
      taskTitle: selected?.title ?? null,
      canDelete: canDeletePhoto(p),
    }))
    setLightbox({ photos: lbPhotos, index: startIndex, sourcePhotos: photos, category })
  }

  function openTask(task: Task) {
    setSelected({ ...task })
    setLiveStatus(task.status)
    setNotes(task.notes ?? '')
    setBeforePhotos([])
    setAfterPhotos([])
    setPendingPhotos([])
    setUploadProgress(null)
  }

  // Load existing photos for the selected task
  useEffect(() => {
    if (!selected?.id || !supabaseReady) return
    setLoadingPhotos(true)
    const supabase = createClient()
    supabase
      .from('task_media')
      .select('storage_path, photo_category, uploaded_by_name, created_at, employee_id')
      .eq('task_id', selected.id)
      .in('photo_category', ['before', 'after'])
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data) { setLoadingPhotos(false); return }
        setBeforePhotos(data.filter(r => r.photo_category === 'before').map(r => ({
          storage_path: r.storage_path,
          uploaded_by_name: r.uploaded_by_name,
          created_at: r.created_at,
          employee_id: r.employee_id,
        })))
        setAfterPhotos(data.filter(r => r.photo_category === 'after').map(r => ({
          storage_path: r.storage_path,
          uploaded_by_name: r.uploaded_by_name,
          created_at: r.created_at,
          employee_id: r.employee_id,
        })))
        setLoadingPhotos(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  async function toggleCheck(taskId: string, index: number, done: boolean) {
    const task = tasks.find(tk => tk.id === taskId)
    if (!task) return
    const checklist: ChecklistItem[] = (task.checklist ?? [])
    const newChecklist = checklist.map((item: ChecklistItem, i: number) =>
      i === index ? { ...item, done } : item
    )
    setTasks(prev => prev.map(tk => tk.id === taskId ? { ...tk, checklist: newChecklist } : tk))
    if (selected?.id === taskId) setSelected(s => s ? { ...s, checklist: newChecklist } : s)

    if (supabaseReady) {
      const payload = { checklist: newChecklist, updated_at: new Date().toISOString() }
      try {
        const supabase = createClient()
        const { error } = await supabase.from('tasks').update(payload).eq('id', taskId)
        if (error) throw error
      } catch (err) {
        await queueIfOffline({ table: 'tasks', type: 'update', match: { id: taskId }, payload }, err)
      }
    }
  }

  async function completeTask(taskId: string) {
    if (afterPhotos.length === 0) {
      alert(t('employee.tasks.afterPhotoRequired'))
      return
    }
    if (!confirm(t('employee.tasks.confirmComplete'))) return
    setSaving(true)
    const projectId = selected?.project_id ?? null
    if (supabaseReady) {
      const update: Record<string, unknown> = {
        status: 'completed',
        updated_at: new Date().toISOString(),
      }
      if (notes) update.notes = notes
      try {
        const supabase = createClient()
        const { error } = await supabase.from('tasks').update(update).eq('id', taskId)
        if (error) throw error
        // Recalculate project progress after completion
        if (projectId && companyId) {
          const { data: allTasks } = await supabase
            .from('tasks')
            .select('status')
            .eq('project_id', projectId)
            .eq('company_id', companyId)
          if (allTasks && allTasks.length > 0) {
            const completed = allTasks.filter(t => t.status === 'completed').length
            const progress = Math.round((completed / allTasks.length) * 100)
            writeFailed((await supabase.from('projects').update({ progress }).eq('id', projectId)).error, 'save your changes')
          }
        }
      } catch (err) {
        await queueIfOffline({ table: 'tasks', type: 'update', match: { id: taskId }, payload: update }, err)
      }
    }
    setTasks(prev => prev.filter(tk => tk.id !== taskId))
    setSelected(null)
    setSaving(false)
    router.refresh()
  }

  async function saveNotes(taskId: string) {
    if (!supabaseReady) return
    const payload = { notes, updated_at: new Date().toISOString() }
    try {
      const supabase = createClient()
      const { error } = await supabase.from('tasks').update(payload).eq('id', taskId)
      if (error) throw error
      setTasks(prev => prev.map(tk => tk.id === taskId ? { ...tk, notes } : tk))
    } catch (err) {
      setTasks(prev => prev.map(tk => tk.id === taskId ? { ...tk, notes } : tk))
      await queueIfOffline({ table: 'tasks', type: 'update', match: { id: taskId }, payload }, err)
    }
  }

  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'blocked' | 'completed'>('all')

  const projectGroups = useMemo(() => {
    const map = new Map<string, { name: string; tasks: Task[] }>()
    for (const task of tasks) {
      const key = task.project_id ?? '__none__'
      const name = task.project?.name ?? 'Tasks'
      if (!map.has(key)) map.set(key, { name, tasks: [] })
      map.get(key)!.tasks.push(task)
    }
    return Array.from(map.values())
  }, [tasks])

  const filteredGroups = useMemo(() => {
    if (statusFilter === 'all') return projectGroups
    return projectGroups
      .map(g => ({ ...g, tasks: g.tasks.filter(tk => tk.status === statusFilter) }))
      .filter(g => g.tasks.length > 0)
  }, [projectGroups, statusFilter])

  const filterCounts = useMemo(() => ({
    all: tasks.length,
    pending: tasks.filter(tk => tk.status === 'pending').length,
    in_progress: tasks.filter(tk => tk.status === 'in_progress').length,
    blocked: tasks.filter(tk => tk.status === 'blocked').length,
    completed: tasks.filter(tk => tk.status === 'completed').length,
  }), [tasks])

  // Task is "started" if status says so, OR if before photos already exist
  const taskStarted = liveStatus === 'in_progress' || liveStatus === 'completed' || beforePhotos.length > 0

  const pendingBefore = pendingPhotos.filter(p => p.category === 'before')
  const pendingAfter  = pendingPhotos.filter(p => p.category === 'after')
  const hasBefore = beforePhotos.length > 0 || pendingBefore.length > 0
  const hasAfter  = afterPhotos.length > 0 || pendingAfter.length > 0

  if (!supabaseReady) {
    return (
      <Card>
        <p className="text-sm text-secondary text-center py-6">{t('employee.tasks.connectSupabase')}</p>
      </Card>
    )
  }

  if (tasks.length === 0) {
    return (
      <Card>
        <div className="py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-green/10 flex items-center justify-center mx-auto mb-3">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-green">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <p className="text-sm font-medium text-primary">{t('employee.tasks.allDone')}</p>
          <p className="text-xs text-secondary mt-1">{t('employee.tasks.noOpenTasksRightNow')}</p>
        </div>
      </Card>
    )
  }

  return (
    <>
      {/* Status filter pills */}
      {tasks.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4 -mx-4 px-4 scrollbar-hide">
          {([
            { key: 'all',         label: t('employee.tasks.filterAll'),        count: filterCounts.all },
            { key: 'pending',     label: t('employee.tasks.filterPending'),    count: filterCounts.pending },
            { key: 'in_progress', label: t('employee.tasks.filterInProgress'), count: filterCounts.in_progress },
            { key: 'blocked',     label: t('employee.tasks.filterBlocked'),    count: filterCounts.blocked },
            { key: 'completed',   label: t('employee.tasks.filterCompleted'),  count: filterCounts.completed },
          ] as const).filter(f => f.key === 'all' || f.count > 0).map(f => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={[
                'flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                statusFilter === f.key
                  ? 'bg-brand text-white border-brand'
                  : 'bg-surface text-secondary border-[var(--border)] hover:border-brand/40',
              ].join(' ')}
            >
              {f.label}
              <span className={`text-[10px] ${statusFilter === f.key ? 'opacity-75' : 'text-tertiary'}`}>
                {f.count}
              </span>
            </button>
          ))}
        </div>
      )}

      {filteredGroups.length === 0 && statusFilter !== 'all' && (
        <div className="py-10 text-center">
          <p className="text-sm text-secondary">{t('employee.tasks.filterNoResults')}</p>
        </div>
      )}

      <div className="space-y-5">
        {filteredGroups.map((group, gi) => {
          const accent = ACCENT_PALETTE[gi % ACCENT_PALETTE.length]
          return (
            <div
              key={`proj-${gi}`}
              className="border border-[var(--border)] rounded-card bg-surface overflow-hidden"
              style={{
                borderLeftWidth: '4px',
                borderLeftColor: accent.borderColor,
                boxShadow: '0 2px 8px rgba(0,0,0,0.09), 0 0 0 0 transparent',
              }}
            >
              {/* Project header */}
              <div className={`px-5 pt-4 pb-3.5 border-b border-[var(--border)] ${accent.headerBgCls}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className="w-9 h-9 rounded-button flex-shrink-0 flex items-center justify-center text-sm font-bold text-white select-none"
                      style={{ backgroundColor: accent.borderColor }}
                    >
                      {group.name.charAt(0).toUpperCase()}
                    </div>
                    <h2 className="text-xl font-bold text-primary leading-tight truncate">
                      {group.name}
                    </h2>
                  </div>
                  <span className="flex-shrink-0 text-xs font-semibold text-secondary bg-surface px-2.5 py-1 rounded-full border border-[var(--border)]">
                    {group.tasks.length} {group.tasks.length === 1 ? 'task' : 'tasks'}
                  </span>
                </div>
              </div>

              {/* Task rows */}
              <div className="divide-y divide-[var(--border)]">
                {group.tasks.map((task: Task) => {
                  const checklist: ChecklistItem[] = task.checklist ?? []
                  const doneCount = checklist.filter((c: ChecklistItem) => c.done).length
                  const totalCount = checklist.length
                  const priority: string = task.priority ?? 'medium'
                  const isInProgress = task.status === 'in_progress'
                  return (
                    <button
                      key={task.id}
                      onClick={() => openTask(task)}
                      className="w-full text-left px-5 py-4 hover:bg-surface-elevated transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[priority] ?? 'bg-secondary'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-primary">{task.title}</p>
                          {task.area && (
                            <p className="text-xs text-tertiary truncate mt-0.5">{task.area}</p>
                          )}
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {isInProgress && (
                              <span className="text-[11px] font-medium text-blue bg-blue/10 px-2 py-0.5 rounded-full">
                                {t('common.inProgress')}
                              </span>
                            )}
                            {priority === 'urgent' && <Badge variant="gray">{t('common.priority.urgent')}</Badge>}
                            {priority === 'high' && <Badge variant="gray">{t('common.priority.high')}</Badge>}
                            {totalCount > 0 && (
                              <span className="text-[11px] text-secondary">
                                {t('employee.tasks.stepsProgress').replace('{done}', String(doneCount)).replace('{total}', String(totalCount))}
                              </span>
                            )}
                            {task.due_date && (
                              <span className={`text-[11px] ${new Date(task.due_date) < new Date() ? 'text-danger' : 'text-tertiary'}`}>
                                {t('employee.tasks.dueDatePrefix')} {new Date(task.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            )}
                          </div>
                        </div>
                        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-tertiary flex-shrink-0 mt-1">
                          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Task detail bottom sheet */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-surface rounded-t-card border-t border-l border-r border-[var(--border)] w-full max-w-lg max-h-[92vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-tertiary/40" />
            </div>

            <div className="px-5 py-4">
              {/* Header */}
              <div className="flex items-start gap-3 mb-4">
                <div className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[selected.priority ?? 'medium'] ?? 'bg-secondary'}`} />
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold text-primary">{selected.title}</h2>
                  {selected.project?.name && <p className="text-xs text-secondary mt-0.5">{selected.project.name}</p>}
                  {selected.area && <p className="text-xs text-tertiary">{selected.area}</p>}
                </div>
                <button onClick={() => setSelected(null)} className="p-1 text-tertiary hover:text-primary">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              {selected.description && (
                <p className="text-sm text-secondary mb-4 leading-relaxed">{selected.description}</p>
              )}

              {/* ── Photos ── */}
              {supabaseReady && (
                <div className="mb-5 space-y-3">

                  {/* Before */}
                  <div className={[
                    'rounded-card border p-3',
                    !hasBefore ? 'border-amber/40 bg-amber/5' : 'border-green/30 bg-green/5',
                  ].join(' ')}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className={['text-xs font-semibold uppercase tracking-wide', !hasBefore ? 'text-amber' : 'text-green'].join(' ')}>
                        {t('employee.tasks.beforeLabel')}
                      </span>
                      {!hasBefore ? (
                        <span className="text-[10px] font-bold text-white bg-amber px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                          {t('employee.tasks.requiredToStart')}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-white bg-green px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                          ✓ {t('employee.tasks.done')}
                        </span>
                      )}
                    </div>

                    {loadingPhotos ? (
                      <div className="h-20 rounded-button bg-surface-elevated animate-pulse" />
                    ) : (
                      <>
                        {/* Thumbnails row */}
                        {(beforePhotos.length > 0 || pendingBefore.length > 0) && (
                          <div className="flex gap-2 overflow-x-auto pb-2 mb-2 -mx-0.5 px-0.5">
                            {beforePhotos.map((photo, i) => (
                              <div key={photo.storage_path} className="flex-shrink-0 flex flex-col items-center" style={{ width: 80 }}>
                                <div className="relative w-20 h-20">
                                  <button
                                    onClick={() => openLightbox(beforePhotos, i, 'before')}
                                    className="w-full h-full rounded-lg overflow-hidden block"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={taskPhotoUrl(photo.storage_path)} alt="Before" className="w-full h-full object-cover" />
                                  </button>
                                  {canDeletePhoto(photo) && (
                                    <button
                                      onClick={() => handleDelete(photo, 'before')}
                                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center"
                                      title="Apagar foto"
                                    >
                                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white">
                                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                                {photo.created_at && (
                                  <p className="text-[9px] text-tertiary mt-0.5 text-center leading-tight w-full">
                                    {new Date(photo.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                    {' '}{new Date(photo.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                )}
                              </div>
                            ))}
                            {pendingBefore.map(p => (
                              <div key={p.id} className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden relative bg-surface-elevated">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.localUrl} alt="" className="w-full h-full object-cover opacity-50" />
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/25">
                                  <WifiOffIcon className="w-4 h-4 text-white" />
                                  <span className="text-[8px] text-white font-semibold uppercase tracking-wide">Pending</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Upload progress */}
                        {uploadProgress?.category === 'before' && (
                          <p className="text-xs text-amber mb-2 font-medium">
                            Uploading {uploadProgress.done} of {uploadProgress.total}…
                          </p>
                        )}

                        {/* Add photo button */}
                        <PhotoPicker
                          onFiles={files => handlePhotos(files, 'before')}
                          disabled={uploadProgress !== null}
                          trigger={open => (
                            <button
                              onClick={open}
                              disabled={uploadProgress !== null}
                              className={[
                                'w-full rounded-button border-2 border-dashed flex items-center justify-center gap-2 transition-colors disabled:opacity-50',
                                hasBefore
                                  ? 'h-10 border-amber/25 bg-transparent hover:bg-amber/5 text-amber/70'
                                  : 'h-20 border-amber/40 bg-surface-elevated hover:bg-amber/5 text-amber flex-col',
                              ].join(' ')}
                            >
                              {uploadProgress?.category === 'before'
                                ? <SpinIcon className="w-4 h-4 text-amber" />
                                : <CameraIcon className={hasBefore ? 'w-4 h-4' : 'w-6 h-6'} />
                              }
                              <span className={`font-medium ${hasBefore ? 'text-[11px]' : 'text-xs'}`}>
                                {hasBefore ? 'Add More' : t('employee.tasks.takeBeforePhoto')}
                              </span>
                            </button>
                          )}
                        />
                      </>
                    )}
                  </div>

                  {/* After */}
                  <div className={[
                    'rounded-card border p-3',
                    !taskStarted ? 'opacity-40 pointer-events-none' : '',
                    !hasAfter ? 'border-[var(--border)] bg-surface-elevated/50' : 'border-green/30 bg-green/5',
                  ].join(' ')}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className={['text-xs font-semibold uppercase tracking-wide', hasAfter ? 'text-green' : 'text-secondary'].join(' ')}>
                        {t('employee.tasks.afterLabel')}
                      </span>
                      {taskStarted && !hasAfter && (
                        <span className="text-[10px] font-bold text-white bg-brand px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                          {t('employee.tasks.requiredToFinish')}
                        </span>
                      )}
                      {hasAfter && (
                        <span className="text-[10px] font-bold text-white bg-green px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                          ✓ {t('employee.tasks.done')}
                        </span>
                      )}
                    </div>

                    {loadingPhotos ? (
                      <div className="h-20 rounded-button bg-surface-elevated animate-pulse" />
                    ) : (
                      <>
                        {/* Thumbnails row */}
                        {(afterPhotos.length > 0 || pendingAfter.length > 0) && (
                          <div className="flex gap-2 overflow-x-auto pb-2 mb-2 -mx-0.5 px-0.5">
                            {afterPhotos.map((photo, i) => (
                              <div key={photo.storage_path} className="flex-shrink-0 flex flex-col items-center" style={{ width: 80 }}>
                                <div className="relative w-20 h-20">
                                  <button
                                    onClick={() => openLightbox(afterPhotos, i, 'after')}
                                    className="w-full h-full rounded-lg overflow-hidden block"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={taskPhotoUrl(photo.storage_path)} alt="After" className="w-full h-full object-cover" />
                                  </button>
                                  {canDeletePhoto(photo) && (
                                    <button
                                      onClick={() => handleDelete(photo, 'after')}
                                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 flex items-center justify-center"
                                      title="Apagar foto"
                                    >
                                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white">
                                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                                      </svg>
                                    </button>
                                  )}
                                </div>
                                {photo.created_at && (
                                  <p className="text-[9px] text-tertiary mt-0.5 text-center leading-tight w-full">
                                    {new Date(photo.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                    {' '}{new Date(photo.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                )}
                              </div>
                            ))}
                            {pendingAfter.map(p => (
                              <div key={p.id} className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden relative bg-surface-elevated">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.localUrl} alt="" className="w-full h-full object-cover opacity-50" />
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/25">
                                  <WifiOffIcon className="w-4 h-4 text-white" />
                                  <span className="text-[8px] text-white font-semibold uppercase tracking-wide">Pending</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Upload progress */}
                        {uploadProgress?.category === 'after' && (
                          <p className="text-xs text-brand mb-2 font-medium">
                            Uploading {uploadProgress.done} of {uploadProgress.total}…
                          </p>
                        )}

                        {/* Add photo button */}
                        <PhotoPicker
                          onFiles={files => handlePhotos(files, 'after')}
                          disabled={uploadProgress !== null || !taskStarted}
                          trigger={open => (
                            <button
                              onClick={open}
                              disabled={uploadProgress !== null || !taskStarted}
                              className={[
                                'w-full rounded-button border-2 border-dashed flex items-center justify-center gap-2 transition-colors disabled:opacity-50',
                                hasAfter
                                  ? 'h-10 border-[var(--border)] bg-transparent hover:bg-black/[0.03] text-secondary'
                                  : 'h-20 border-[var(--border)] bg-surface-elevated hover:bg-black/[0.03] text-secondary flex-col',
                              ].join(' ')}
                            >
                              {uploadProgress?.category === 'after'
                                ? <SpinIcon className="w-4 h-4 text-secondary" />
                                : <CameraIcon className={hasAfter ? 'w-4 h-4' : 'w-6 h-6'} />
                              }
                              <span className={`${hasAfter ? 'text-[11px]' : 'text-xs'}`}>
                                {hasAfter ? 'Add More' : t('employee.tasks.addAfter')}
                              </span>
                            </button>
                          )}
                        />
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Checklist — locked until started */}
              {selected.checklist && selected.checklist.length > 0 && (
                <div className={['mb-5', !taskStarted ? 'opacity-40 pointer-events-none' : ''].join(' ')}>
                  <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">{t('employee.tasks.checklistLabel')}</p>
                  <div className="space-y-2">
                    {(selected.checklist as ChecklistItem[]).map((item, i) => (
                      <label key={i} className="flex items-center gap-3 cursor-pointer group">
                        <div
                          className={[
                            'w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 transition-all',
                            item.done
                              ? 'bg-green border-green'
                              : 'border-[var(--border-strong)] group-hover:border-green/50',
                          ].join(' ')}
                          onClick={() => toggleCheck(selected.id, i, !item.done)}
                        >
                          {item.done && (
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <span className={`text-sm ${item.done ? 'text-tertiary line-through' : 'text-primary'}`}>
                          {item.text}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Notes — locked until started */}
              <div className={['mb-5', !taskStarted ? 'opacity-40 pointer-events-none' : ''].join(' ')}>
                <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">{t('employee.tasks.notesLabel')}</p>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  onBlur={() => taskStarted && saveNotes(selected.id)}
                  placeholder={t('employee.tasks.notesPlaceholder')}
                  disabled={!taskStarted}
                  className="w-full bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none resize-none transition-colors disabled:opacity-50"
                />
              </div>

              {/* Undo delete toast */}
              {pendingDelete && (
                <div className="mb-3 flex items-center justify-between px-4 py-3 rounded-card bg-surface-elevated border border-[var(--border)] shadow-sm">
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-danger flex-shrink-0">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    <p className="text-sm text-secondary">Foto apagada</p>
                  </div>
                  <button
                    onClick={undoDelete}
                    className="text-sm font-semibold text-brand hover:text-brand/80 transition-colors"
                  >
                    Desfazer
                  </button>
                </div>
              )}

              {/* CTA */}
              {!taskStarted ? (
                <div className="w-full flex items-center justify-center gap-2 h-12 rounded-button bg-amber/10 border border-amber/30 text-amber font-medium text-sm">
                  <CameraIcon className="w-5 h-5" />
                  {t('employee.tasks.takeBeforeToStart')}
                </div>
              ) : (
                <button
                  onClick={() => completeTask(selected.id)}
                  disabled={saving || afterPhotos.length === 0}
                  className="w-full flex items-center justify-center gap-2 h-12 rounded-button bg-green text-white font-semibold text-base hover:bg-green/90 transition-colors disabled:opacity-60"
                >
                  {saving ? (
                    <SpinIcon className="w-4 h-4" />
                  ) : (
                    <>
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      {afterPhotos.length === 0 ? t('employee.tasks.afterPhotoRequiredBtn') : t('employee.tasks.markComplete')}
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="safe-bottom" />
          </div>
        </div>
      )}

      {/* Fullscreen lightbox */}
      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onDelete={idx => {
            const photo = lightbox.sourcePhotos[idx]
            if (photo) {
              setLightbox(null)
              handleDelete(photo, lightbox.category)
            }
          }}
        />
      )}
    </>
  )
}
