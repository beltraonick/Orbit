'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { PlanViewer } from '@/components/admin/PlanViewer'
import type { PlanMarker } from '@/components/admin/PlanViewer'
import { KanbanBoard } from './KanbanBoard'
import { TeamClockIn } from '@/app/(employee)/projects/[id]/TeamClockIn'
import { useCompanyId } from '@/lib/company-context'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { PhotoPicker } from '@/components/ui/PhotoPicker'
import { PhotoLightbox, type LightboxPhoto } from '@/components/ui/PhotoLightbox'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

const supabaseReady =
  SUPABASE_URL && !SUPABASE_URL.startsWith('your_')

function planUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/plans/${path}`
}

function photoUrl(path: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/project-photos/${path}`
}

interface Project {
  id: string
  name: string
  client_name: string | null
  client_email: string | null
  client_phone: string | null
  address: string | null
  description: string | null
  progress: number
  status: string
  start_date: string | null
  end_date: string | null
  created_at: string
  project_type?: string | null
  budget?: number | null
  hotel_name?: string | null
  leader_id?: string | null
}

interface PlanSheet {
  id: string
  plan_id: string
  storage_path: string
  file_type: string
  page_number: number
}

interface ProjectPlan {
  id: string
  name: string
  created_at: string
  sheets: PlanSheet[]
  markers: PlanMarker[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Task = Record<string, any> & { id: string; title: string; status: string }

interface Photo {
  id: string
  storage_path: string
  tag: string
  caption: string | null
  created_at: string
}

type Tab = 'overview' | 'plans' | 'tasks' | 'photos' | 'team'

function statusBadge(s: string, t: (key: string) => string) {
  const map: Record<string, { label: string; variant: 'green' | 'amber' | 'blue' | 'gray' }> = {
    active:    { label: t('common.active'), variant: 'green' },
    on_hold:   { label: t('admin.projectDetail.statusOnHold'), variant: 'amber' },
    completed: { label: t('common.completed'), variant: 'blue' },
    cancelled: { label: t('admin.projectDetail.statusCancelled'), variant: 'gray' },
  }
  const c = map[s] ?? { label: s, variant: 'gray' as const }
  return <Badge variant={c.variant}>{c.label}</Badge>
}

export default function ProjectDetailPage() {
  const { t, locale } = useTranslation()
  const params = useParams()
  const projectId = params.id as string
  const router = useRouter()
  const companyId = useCompanyId()

  const STATUS_OPTIONS = [
    { value: 'active', label: t('common.active') },
    { value: 'on_hold', label: t('admin.projectDetail.statusOnHold') },
    { value: 'completed', label: t('common.completed') },
    { value: 'cancelled', label: t('admin.projectDetail.statusCancelled') },
  ]

  const PRIORITY_OPTS = [
    { value: 'low',    label: t('common.priority.low') },
    { value: 'medium', label: t('common.priority.medium') },
    { value: 'high',   label: t('common.priority.high') },
    { value: 'urgent', label: t('common.priority.urgent') },
  ]

  const MARKER_TYPE_OPTS = [
    { value: 'task', label: t('admin.projectDetail.markerTypeTask') },
    { value: 'note', label: t('admin.projectDetail.markerTypeNote') },
  ]

  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  // Overview edit
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Plans
  const [plans, setPlans] = useState<ProjectPlan[]>([])
  const [loadingPlans, setLoadingPlans] = useState(false)
  const [plansFetched, setPlansFetched] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<ProjectPlan | null>(null)
  const [sheetIndex, setSheetIndex] = useState(0)
  const [addMarkerMode, setAddMarkerMode] = useState(false)
  const [pendingMarker, setPendingMarker] = useState<{ x: number; y: number } | null>(null)
  const [markerForm, setMarkerForm] = useState({ type: 'task', title: '', description: '', priority: 'medium' })
  const [savingMarker, setSavingMarker] = useState(false)
  const [uploadingPlan, setUploadingPlan] = useState(false)
  const planFileRef = useRef<HTMLInputElement>(null)

  // Employees (for kanban assignee)
  const [employees, setEmployees] = useState<{ id: string; full_name: string }[]>([])

  // Tasks (legacy state kept to avoid refactoring fetchTasks callback)
  const [_tasks, setTasks] = useState<Task[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [tasksFetched, setTasksFetched] = useState(false)

  // Photos
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [photosFetched, setPhotosFetched] = useState(false)
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  // Undo-delete
  const [pendingPhotoDelete, setPendingPhotoDelete] = useState<{
    photo: Photo
    timer: ReturnType<typeof setTimeout>
  } | null>(null)
  const pendingPhotoDeleteRef = useRef<typeof pendingPhotoDelete>(null)

  // Load project + employees
  useEffect(() => {
    if (!supabaseReady) { setLoading(false); return }
    const supabase = createClient()
    Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).single(),
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId).eq('auth_status', 'approved').order('full_name'),
    ]).then(([{ data }, { data: emps }]) => {
      if (data) {
        setProject(data as Project)
        setEditForm({
          name: data.name ?? '',
          address: data.address ?? '',
          client_name: data.client_name ?? '',
          client_email: data.client_email ?? '',
          client_phone: data.client_phone ?? '',
          description: data.description ?? '',
          status: data.status ?? 'active',
          progress: String(data.progress ?? 0),
          start_date: data.start_date ?? '',
          end_date: data.end_date ?? '',
        })
      } else {
        router.push('/admin/projects')
      }
      setEmployees(emps ?? [])
      setLoading(false)
    })
  }, [projectId, companyId, router])

  const fetchPlans = useCallback(async () => {
    if (!supabaseReady || loadingPlans || plansFetched) return
    setLoadingPlans(true)
    const supabase = createClient()
    try {
      const { data: planRows } = await supabase
        .from('project_plans')
        .select('id, name, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })

      if (!planRows) { setLoadingPlans(false); setPlansFetched(true); return }

      const withSheets = await Promise.all(planRows.map(async (plan) => {
        const { data: sheets } = await supabase
          .from('plan_sheets')
          .select('*')
          .eq('plan_id', plan.id)
          .order('page_number')
        const sheetRows = (sheets ?? []) as PlanSheet[]
        const allMarkers: PlanMarker[] = []
        for (const sheet of sheetRows) {
          const { data: sm } = await supabase
            .from('plan_markers')
            .select('*')
            .eq('sheet_id', sheet.id)
            .order('created_at')
          allMarkers.push(...((sm ?? []) as PlanMarker[]))
        }
        return { ...plan, sheets: sheetRows, markers: allMarkers } as ProjectPlan
      }))

      setPlans(withSheets)
    } catch {
      // tables may not exist yet — silent
    }
    setPlansFetched(true)
    setLoadingPlans(false)
  }, [projectId, loadingPlans, plansFetched])

  const fetchTasks = useCallback(async () => {
    if (!supabaseReady || loadingTasks || tasksFetched) return
    setLoadingTasks(true)
    setTasks([])
    setTasksFetched(true)
    setLoadingTasks(false)
  }, [loadingTasks, tasksFetched])

  const fetchPhotos = useCallback(async () => {
    if (!supabaseReady || loadingPhotos || photosFetched) return
    setLoadingPhotos(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('project_photos')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
    setPhotos((data ?? []) as Photo[])
    setPhotosFetched(true)
    setLoadingPhotos(false)
  }, [projectId, loadingPhotos, photosFetched])

  useEffect(() => {
    if (activeTab === 'plans') fetchPlans()
    if (activeTab === 'tasks') fetchTasks()
    if (activeTab === 'photos') fetchPhotos()
  }, [activeTab, fetchPlans, fetchTasks, fetchPhotos])

  async function saveProject(e: React.FormEvent) {
    e.preventDefault()
    if (!project) return
    setSaving(true)
    const supabase = createClient()
    const payload = {
      name: editForm.name,
      address: editForm.address || null,
      client_name: editForm.client_name || null,
      client_email: editForm.client_email || null,
      client_phone: editForm.client_phone || null,
      description: editForm.description || null,
      status: editForm.status,
      start_date: editForm.start_date || null,
      end_date: editForm.end_date || null,
    }
    const { data } = await supabase.from('projects').update(payload).eq('id', project.id).select().single()
    if (data) setProject(data as Project)
    setSaving(false)
    setEditing(false)
  }

  async function uploadPlan(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !supabaseReady) return
    e.target.value = ''

    setUploadingPlan(true)
    const supabase = createClient()

    // 1. Create plan record
    const { data: plan, error: planErr } = await supabase
      .from('project_plans')
      .insert({ project_id: projectId, company_id: companyId, name: file.name.replace(/\.[^.]+$/, '') })
      .select()
      .single()

    if (planErr || !plan) { setUploadingPlan(false); alert(t('admin.projectDetail.failedCreatePlan')); return }

    // 2. Upload file
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const storagePath = `${projectId}/${plan.id}/sheet-1.${ext}`
    const { error: uploadErr } = await supabase.storage.from('plans').upload(storagePath, file, { contentType: file.type, upsert: true })

    if (uploadErr) {
      await supabase.from('project_plans').delete().eq('id', plan.id)
      setUploadingPlan(false)
      alert(t('admin.projectDetail.uploadFailedPlanBucket'))
      return
    }

    // 3. Create sheet record
    const fileType = ext === 'pdf' ? 'pdf' : 'image'
    const { data: sheet } = await supabase
      .from('plan_sheets')
      .insert({ plan_id: plan.id, project_id: projectId, company_id: companyId, storage_path: storagePath, file_type: fileType, page_number: 1 })
      .select()
      .single()

    const newPlan: ProjectPlan = { ...plan, sheets: sheet ? [sheet as PlanSheet] : [], markers: [] }
    setPlans(prev => [newPlan, ...prev])
    setSelectedPlan(newPlan)
    setSheetIndex(0)
    setUploadingPlan(false)
  }

  async function saveMarker() {
    if (!pendingMarker || !selectedPlan) return
    const currentSheet = selectedPlan.sheets[sheetIndex]
    if (!currentSheet) return

    setSavingMarker(true)
    const supabase = createClient()

    let taskId: string | null = null

    if (markerForm.type === 'task') {
      try {
        const payload: Record<string, unknown> = {
          project_id: projectId,
          company_id: companyId,
          title: markerForm.title,
          description: markerForm.description || null,
          status: 'pending',
          plan_sheet_id: currentSheet.id,
          plan_x_pct: pendingMarker.x,
          plan_y_pct: pendingMarker.y,
        }
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (payload as any).priority = markerForm.priority
        } catch { /* column may not exist */ }

        const { data: task } = await supabase.from('tasks').insert(payload).select().single()
        taskId = task?.id ?? null
      } catch { /* silent */ }
    }

    try {
      const { data: marker } = await supabase
        .from('plan_markers')
        .insert({
          sheet_id: currentSheet.id,
          project_id: projectId,
          company_id: companyId,
          marker_type: markerForm.type,
          title: markerForm.title,
          description: markerForm.description || null,
          x_pct: pendingMarker.x,
          y_pct: pendingMarker.y,
          task_id: taskId,
        })
        .select()
        .single()

      if (marker) {
        const newMarker = marker as PlanMarker
        setSelectedPlan(prev => {
          if (!prev) return prev
          return { ...prev, markers: [...prev.markers, newMarker] }
        })
        setPlans(prev => prev.map(p =>
          p.id === selectedPlan.id ? { ...p, markers: [...p.markers, newMarker] } : p
        ))
      }
    } catch {
      alert(t('admin.projectDetail.failedSaveMarker'))
    }

    setPendingMarker(null)
    setMarkerForm({ type: 'task', title: '', description: '', priority: 'medium' })
    setSavingMarker(false)
  }

  async function handlePhotoUpload(files: File[]) {
    if (files.length === 0 || !supabaseReady) return
    setUploadingPhoto(true)
    setUploadProgress({ done: 0, total: files.length })
    const supabase = createClient()
    const newRows: Photo[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${projectId}/misc-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage.from('project-photos').upload(path, file, { contentType: file.type, upsert: true })
      if (!error) {
        const { data: row } = await supabase
          .from('project_photos')
          .insert({ project_id: projectId, company_id: companyId, storage_path: path, tag: 'progress' })
          .select().single()
        if (row) newRows.push(row as Photo)
      }
      setUploadProgress({ done: i + 1, total: files.length })
    }
    if (newRows.length > 0) setPhotos(prev => [...newRows.reverse(), ...prev])
    setUploadProgress(null)
    setUploadingPhoto(false)
  }

  function deletePhoto(photo: Photo) {
    if (!window.confirm(t('admin.photos.deleteConfirm'))) return

    // Flush any existing pending delete first
    if (pendingPhotoDeleteRef.current) {
      const prev = pendingPhotoDeleteRef.current
      clearTimeout(prev.timer)
      pendingPhotoDeleteRef.current = null
      setPendingPhotoDelete(null)
      const supabase = createClient()
      supabase.storage.from('project-photos').remove([prev.photo.storage_path])
      supabase.from('project_photos').delete().eq('id', prev.photo.id)
    }

    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    setLightbox(null)

    const timer = setTimeout(() => {
      pendingPhotoDeleteRef.current = null
      setPendingPhotoDelete(null)
      const supabase = createClient()
      supabase.storage.from('project-photos').remove([photo.storage_path])
      supabase.from('project_photos').delete().eq('id', photo.id)
    }, 5000)

    const pd = { photo, timer }
    pendingPhotoDeleteRef.current = pd
    setPendingPhotoDelete(pd)
  }

  function undoPhotoDelete() {
    const pd = pendingPhotoDeleteRef.current
    if (!pd) return
    clearTimeout(pd.timer)
    pendingPhotoDeleteRef.current = null
    setPendingPhotoDelete(null)
    setPhotos(prev => [pd.photo, ...prev])
  }

  function openLightbox(index: number) {
    const lbPhotos: LightboxPhoto[] = photos.map(p => ({
      url: photoUrl(p.storage_path),
      category: null,
      uploaderName: null,
      createdAt: p.created_at ?? null,
      projectName: null,
      taskTitle: null,
    }))
    setLightbox({ photos: lbPhotos, index })
  }

  const currentSheet = selectedPlan?.sheets[sheetIndex]
  const currentSheetMarkers = selectedPlan
    ? selectedPlan.markers.filter(m => currentSheet && (m as unknown as Record<string, string>).sheet_id === currentSheet.id)
    : []

  if (loading) {
    return (
      <div className="p-4 md:p-8 flex items-center justify-center min-h-[50vh]">
        <p className="text-secondary text-sm">{t('admin.projectDetail.loadingProject')}</p>
      </div>
    )
  }

  if (!project && supabaseReady) {
    return (
      <div className="p-4 md:p-8 text-center">
        <p className="text-secondary">{t('admin.projectDetail.projectNotFound')}</p>
        <Button onClick={() => router.push('/admin/projects')} variant="secondary" className="mt-4">
          {t('admin.projectDetail.backToProjectsButton')}
        </Button>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      {/* Header */}
      <div className="mb-5 md:mb-6">
        <button
          onClick={() => router.push('/admin/projects')}
          className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary transition-colors mb-3"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
          {t('admin.projectDetail.backToProjects')}
        </button>

        {project ? (
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{project.name}</h1>
                {statusBadge(project.status, t)}
              </div>
              {project.address && <p className="text-sm text-secondary mt-0.5">{project.address}</p>}
            </div>
            <Button onClick={() => setEditing(true)} variant="secondary" className="flex-shrink-0">
              {t('admin.projectDetail.edit')}
            </Button>
          </div>
        ) : (
          <div className="bg-amber/5 border border-amber/20 rounded-card p-4">
            <p className="text-sm text-amber">{t('admin.projectDetail.connectSupabaseDetails')}</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-[var(--border)] mb-6 overflow-x-auto">
        {(['overview', 'plans', 'tasks', 'team', 'photos'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'px-4 py-3 text-sm font-medium flex-shrink-0 transition-colors border-b-2 -mb-px',
              activeTab === tab
                ? 'border-brand text-primary'
                : 'border-transparent text-secondary hover:text-primary',
            ].join(' ')}
          >
            {tab === 'team'
              ? t('supervisor.tabs.teamClock')
              : t(`admin.projectDetail.tab${tab.charAt(0).toUpperCase()}${tab.slice(1)}`)}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {activeTab === 'overview' && project && (
        <div className="space-y-4">
          {/* Progress */}
          <Card>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-secondary">{t('admin.projectDetail.progress')}</p>
              <p className="text-lg font-bold text-primary">{project.progress}%</p>
            </div>
            <ProgressBar value={project.progress} />
          </Card>

          {/* Info grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">{t('admin.projectDetail.projectInfo')}</p>
              <div className="space-y-2">
                {project.address && (
                  <div>
                    <p className="text-xs text-tertiary">{t('admin.projectDetail.address')}</p>
                    <p className="text-sm text-primary">{project.address}</p>
                  </div>
                )}
                {project.start_date && (
                  <div>
                    <p className="text-xs text-tertiary">{t('admin.projectDetail.startDate')}</p>
                    <p className="text-sm text-primary">{new Date(project.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                )}
                {project.end_date && (
                  <div>
                    <p className="text-xs text-tertiary">{t('admin.projectDetail.endDate')}</p>
                    <p className="text-sm text-primary">{new Date(project.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-tertiary">{t('admin.projectDetail.created')}</p>
                  <p className="text-sm text-primary">{new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                </div>
              </div>
            </Card>

            <Card>
              <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">{t('admin.projectDetail.client')}</p>
              <div className="space-y-2">
                {project.client_name ? (
                  <>
                    <div>
                      <p className="text-xs text-tertiary">{t('admin.projectDetail.name')}</p>
                      <p className="text-sm text-primary">{project.client_name}</p>
                    </div>
                    {project.client_email && (
                      <div>
                        <p className="text-xs text-tertiary">{t('admin.projectDetail.email')}</p>
                        <p className="text-sm text-primary">{project.client_email}</p>
                      </div>
                    )}
                    {project.client_phone && (
                      <div>
                        <p className="text-xs text-tertiary">{t('admin.projectDetail.phone')}</p>
                        <p className="text-sm text-primary">{project.client_phone}</p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-tertiary">{t('admin.projectDetail.noClientAssigned')}</p>
                )}
              </div>
            </Card>
          </div>

          {project.description && (
            <Card>
              <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">{t('admin.projectDetail.description')}</p>
              <p className="text-sm text-secondary leading-relaxed">{project.description}</p>
            </Card>
          )}
        </div>
      )}

      {/* ── PLANS ── */}
      {activeTab === 'plans' && (
        <div>
          {/* Plan viewer */}
          {selectedPlan && currentSheet && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setSelectedPlan(null); setAddMarkerMode(false) }}
                    className="text-secondary hover:text-primary transition-colors"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <h2 className="text-sm font-semibold text-primary">{selectedPlan.name}</h2>
                  <span className="text-xs text-tertiary">{t('admin.projectDetail.markerCount').replace('{n}', String(selectedPlan.markers.length)).replace('{plural}', selectedPlan.markers.length !== 1 ? 's' : '')}</span>
                </div>
                <button
                  onClick={() => setAddMarkerMode(m => !m)}
                  className={[
                    'flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-button transition-colors',
                    addMarkerMode
                      ? 'bg-brand text-white'
                      : 'bg-surface-elevated text-secondary hover:text-primary border border-[var(--border)]',
                  ].join(' ')}
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                  </svg>
                  {addMarkerMode ? t('admin.projectDetail.cancel') : t('admin.projectDetail.addMarker')}
                </button>
              </div>

              {/* Sheet tabs */}
              {selectedPlan.sheets.length > 1 && (
                <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
                  {selectedPlan.sheets.map((sheet, i) => (
                    <button
                      key={sheet.id}
                      onClick={() => setSheetIndex(i)}
                      className={[
                        'text-xs px-3 py-1.5 rounded-button flex-shrink-0 transition-colors',
                        sheetIndex === i
                          ? 'bg-brand text-white'
                          : 'bg-surface-elevated text-secondary hover:text-primary border border-[var(--border)]',
                      ].join(' ')}
                    >
                      {t('admin.projectDetail.sheetNumber').replace('{n}', String(sheet.page_number))}
                    </button>
                  ))}
                </div>
              )}

              {currentSheet.file_type === 'pdf' ? (
                <div className="rounded-card overflow-hidden" style={{ height: 480 }}>
                  <iframe
                    src={planUrl(currentSheet.storage_path)}
                    className="w-full h-full"
                    title={t('admin.projectDetail.pdfPlanTitle')}
                    style={{ border: 'none' }}
                  />
                  <p className="text-xs text-tertiary mt-2">{t('admin.projectDetail.pdfMarkerNote')}</p>
                </div>
              ) : (
                <PlanViewer
                  imageUrl={planUrl(currentSheet.storage_path)}
                  markers={currentSheetMarkers}
                  addMarkerMode={addMarkerMode}
                  onAddMarker={(x, y) => {
                    setPendingMarker({ x, y })
                    setMarkerForm({ type: 'task', title: '', description: '', priority: 'medium' })
                  }}
                  onMarkerClick={m => alert(t('admin.projectDetail.markerAlert').replace('{type}', (m.marker_type === 'task' ? t('admin.projectDetail.markerTypeTask') : t('admin.projectDetail.markerTypeNote')).toUpperCase()).replace('{title}', m.title))}
                />
              )}
            </div>
          )}

          {/* Plans list */}
          {!selectedPlan && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-primary">{t('admin.projectDetail.floorPlansTitle')}</h2>
                <div className="flex items-center gap-2">
                  {!supabaseReady && <span className="text-xs text-amber">{t('admin.projectDetail.connectSupabase')}</span>}
                  <Button
                    onClick={() => planFileRef.current?.click()}
                    loading={uploadingPlan}
                    disabled={!supabaseReady || uploadingPlan}
                  >
                    {uploadingPlan ? t('admin.projectDetail.uploading') : t('admin.projectDetail.uploadPlan')}
                  </Button>
                </div>
              </div>
              <input
                ref={planFileRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,application/pdf"
                className="hidden"
                onChange={uploadPlan}
              />

              {loadingPlans && <p className="text-sm text-secondary text-center py-8">{t('admin.projectDetail.loadingPlans')}</p>}

              {!loadingPlans && plans.length === 0 && (
                <Card>
                  <div className="py-12 text-center">
                    <div className="w-12 h-12 rounded-full bg-brand/10 flex items-center justify-center mx-auto mb-3">
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-brand">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-primary">{t('admin.projectDetail.noPlansYet')}</p>
                    <p className="text-xs text-secondary mt-1">{t('admin.projectDetail.noPlansHint')}</p>
                  </div>
                </Card>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {plans.map(plan => {
                  const firstSheet = plan.sheets[0]
                  const isPdf = firstSheet?.file_type === 'pdf'
                  return (
                    <div key={plan.id} className="rounded-card border border-[var(--border)] bg-surface overflow-hidden flex flex-col">
                      {/* Thumbnail */}
                      <div className="aspect-[4/3] bg-surface-elevated relative">
                        {firstSheet && !isPdf ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={planUrl(firstSheet.storage_path)}
                            alt={plan.name}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                            <svg viewBox="0 0 20 20" fill="currentColor" className="w-10 h-10 text-brand/40">
                              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                            </svg>
                            {isPdf && <span className="text-xs font-semibold text-tertiary tracking-wider uppercase">PDF</span>}
                          </div>
                        )}
                        {/* Marker badge */}
                        {plan.markers.length > 0 && (
                          <span className="absolute top-2 right-2 bg-brand text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                            {t('admin.projectDetail.pinCount')
                              .replace('{n}', String(plan.markers.length))
                              .replace('{plural}', plan.markers.length !== 1 ? 's' : '')}
                          </span>
                        )}
                      </div>
                      {/* Info + View button */}
                      <div className="p-3 flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-primary truncate">{plan.name}</p>
                          <p className="text-xs text-tertiary mt-0.5">
                            {new Date(plan.created_at).toLocaleDateString()}
                            {plan.sheets.length > 1 && ` · ${plan.sheets.length} sheets`}
                          </p>
                        </div>
                        <button
                          onClick={() => { setSelectedPlan(plan); setSheetIndex(0); setAddMarkerMode(false) }}
                          className="flex-shrink-0 flex items-center gap-1 text-xs font-medium text-brand hover:text-brand/80 bg-brand/10 hover:bg-brand/20 px-3 py-1.5 rounded-button transition-colors"
                        >
                          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                            <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                          </svg>
                          {t('admin.projectDetail.viewPlan') || 'View'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── TASKS (Kanban) ── */}
      {activeTab === 'tasks' && (
        <KanbanBoard
          projectId={projectId}
          companyId={companyId}
          employees={employees}
        />
      )}

      {/* ── TEAM CLOCK-IN ── */}
      {activeTab === 'team' && (
        <TeamClockIn projectId={projectId} />
      )}

      {/* ── PHOTOS ── */}
      {activeTab === 'photos' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-primary">{t('admin.projectDetail.photosHeading')}</h2>
            <PhotoPicker
              onFiles={handlePhotoUpload}
              multiple
              disabled={!supabaseReady || uploadingPhoto}
              trigger={open => (
                <button
                  onClick={open}
                  disabled={!supabaseReady || uploadingPhoto}
                  className="flex items-center gap-2 px-4 py-2 rounded-button bg-brand text-white text-sm font-medium hover:bg-brand/90 transition-colors disabled:opacity-60"
                >
                  {uploadProgress ? (
                    <>
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                      </svg>
                      {uploadProgress.done}/{uploadProgress.total}
                    </>
                  ) : (
                    <>+ {t('admin.projectDetail.addPhoto')}</>
                  )}
                </button>
              )}
            />
          </div>

          {loadingPhotos && <p className="text-sm text-secondary text-center py-8">{t('admin.projectDetail.loadingPhotos')}</p>}
          {!loadingPhotos && photos.length === 0 && (
            <Card>
              <p className="text-sm text-secondary text-center py-8">{t('admin.projectDetail.noPhotosYet')}</p>
            </Card>
          )}

          <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
            {photos.map((p, idx) => (
              <div key={p.id} className="flex flex-col gap-1">
                <div className="relative aspect-square rounded-button overflow-hidden bg-surface-elevated">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrl(p.storage_path)}
                    alt={t('admin.projectDetail.projectPhotoAlt')}
                    className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform duration-300"
                    onClick={() => openLightbox(idx)}
                  />
                  <button
                    onClick={() => deletePhoto(p)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-red-500/80 transition-colors"
                    title={t('common.delete')}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                {p.created_at && (
                  <p className="text-[10px] text-tertiary px-0.5">
                    {new Date(p.created_at).toLocaleDateString(locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                    {' '}{new Date(p.created_at).toLocaleTimeString(locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Undo delete toast */}
          {pendingPhotoDelete && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-5 py-3 rounded-card bg-surface border border-[var(--border)] shadow-xl">
              <p className="text-sm text-secondary">{t('admin.projectDetail.photoDeleted')}</p>
              <button
                onClick={undoPhotoDelete}
                className="text-sm font-semibold text-brand hover:text-brand/80 transition-colors"
              >
                {t('admin.projectDetail.undoDelete')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Edit Project Modal ── */}
      {editing && project && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setEditing(false)}
        >
          <div
            className="bg-surface rounded-card border border-[var(--border)] w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-6">
              <h2 className="text-base font-semibold text-primary mb-5">{t('admin.projectDetail.editProjectTitle')}</h2>
              <form onSubmit={saveProject} className="space-y-4">
                <Input
                  label={t('admin.projectDetail.projectName')}
                  required
                  value={editForm.name ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                />
                <Input
                  label={t('admin.projectDetail.address')}
                  placeholder={t('admin.projectDetail.addressPlaceholder')}
                  value={editForm.address ?? ''}
                  onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                />
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label={t('admin.projectDetail.clientName')}
                    value={editForm.client_name ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, client_name: e.target.value }))}
                  />
                  <Input
                    label={t('admin.projectDetail.clientEmail')}
                    type="email"
                    value={editForm.client_email ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, client_email: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label={t('admin.projectDetail.startDate')}
                    type="date"
                    value={editForm.start_date ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))}
                  />
                  <Input
                    label={t('admin.projectDetail.endDate')}
                    type="date"
                    value={editForm.end_date ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, end_date: e.target.value }))}
                  />
                </div>
                <Select
                  label={t('admin.projectDetail.status')}
                  options={STATUS_OPTIONS}
                  value={editForm.status ?? 'active'}
                  onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}
                />
                <div>
                  <p className="text-xs font-medium text-secondary mb-1">
                    {t('admin.projectDetail.progressPercent').replace('{n}', String(project.progress ?? 0))}
                  </p>
                  <p className="text-[11px] text-tertiary">{t('admin.projectDetail.progressAutoNote')}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">{t('admin.projectDetail.description')}</label>
                  <textarea
                    rows={3}
                    value={editForm.description ?? ''}
                    onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                    className="w-full bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none resize-none"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button type="button" variant="secondary" onClick={() => setEditing(false)} className="flex-1">{t('common.cancel')}</Button>
                  <Button type="submit" loading={saving} className="flex-1">{t('admin.projectDetail.saveChanges')}</Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ── Marker Modal ── */}
      {pendingMarker && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setPendingMarker(null)}
        >
          <div
            className="bg-surface rounded-card border border-[var(--border)] w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5">
              <h2 className="text-base font-semibold text-primary mb-4">{t('admin.projectDetail.addMarkerTitle')}</h2>
              <div className="space-y-3">
                <Select
                  label={t('admin.projectDetail.type')}
                  options={MARKER_TYPE_OPTS}
                  value={markerForm.type}
                  onChange={e => setMarkerForm(f => ({ ...f, type: e.target.value }))}
                />
                <Input
                  label={t('admin.projectDetail.title')}
                  required
                  placeholder={markerForm.type === 'task' ? t('admin.projectDetail.taskTitlePlaceholder') : t('admin.projectDetail.noteTitlePlaceholder')}
                  value={markerForm.title}
                  onChange={e => setMarkerForm(f => ({ ...f, title: e.target.value }))}
                />
                {markerForm.type === 'task' && (
                  <Select
                    label={t('admin.projectDetail.priority')}
                    options={PRIORITY_OPTS}
                    value={markerForm.priority}
                    onChange={e => setMarkerForm(f => ({ ...f, priority: e.target.value }))}
                  />
                )}
                <div>
                  <label className="block text-xs font-medium text-secondary mb-1">{t('admin.projectDetail.description')}</label>
                  <textarea
                    rows={2}
                    value={markerForm.description}
                    onChange={e => setMarkerForm(f => ({ ...f, description: e.target.value }))}
                    placeholder={t('admin.projectDetail.optionalPlaceholder')}
                    className="w-full bg-surface-elevated text-sm text-primary placeholder:text-tertiary rounded-input px-3 py-2.5 border border-[var(--border)] focus:border-brand/50 outline-none resize-none"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-4">
                <Button type="button" variant="secondary" onClick={() => setPendingMarker(null)} className="flex-1">{t('admin.projectDetail.cancel')}</Button>
                <Button
                  onClick={saveMarker}
                  loading={savingMarker}
                  disabled={!markerForm.title.trim() || savingMarker}
                  className="flex-1"
                >
                  {markerForm.type === 'task' ? t('admin.projectDetail.createTask') : t('admin.projectDetail.saveNote')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Photo Lightbox ── */}
      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onDelete={idx => {
            const photo = photos[idx]
            if (photo) deletePhoto(photo)
          }}
        />
      )}
    </div>
  )
}
