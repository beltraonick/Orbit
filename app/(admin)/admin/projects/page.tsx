'use client'

import { writeFailed } from '@/lib/write-feedback'
import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { checkProjectLimit } from '@/lib/plan-limits'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { useTranslation } from '@/lib/i18n/LocaleContext'

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

interface Project {
  id: string
  name: string
  status: string
  city: string | null
  state: string | null
  hotel_name: string | null
  leader_id: string | null
  budget: number | null
  client_name: string | null
  client_email: string | null
  created_at: string
  cover_image_path: string | null
}

interface Profile {
  id: string
  full_name: string
}

const BLANK = {
  name: '', status: 'active', city: '', state: '',
  hotel_name: '', leader_id: '', budget: '', client_name: '', client_email: '',
}

const STATUS_COLORS: Record<string, { bar: string }> = {
  active:    { bar: 'bg-green' },
  completed: { bar: 'bg-blue' },
  on_hold:   { bar: 'bg-amber' },
}

function statusBadge(s: string, t: (key: string) => string) {
  if (s === 'active') return <Badge variant="green">{t('common.active')}</Badge>
  if (s === 'completed') return <Badge variant="blue">{t('common.completed')}</Badge>
  return <Badge variant="amber">{t('admin.projects.statusOnHold')}</Badge>
}

function coverUrl(path: string) {
  return createClient().storage.from('project-photos').getPublicUrl(path).data.publicUrl
}

function ProjectCard({
  project,
  leader,
  onEdit,
  t,
}: {
  project: Project
  leader: Profile | undefined
  onEdit: (p: Project) => void
  t: (key: string) => string
}) {
  const colors = STATUS_COLORS[project.status] ?? STATUS_COLORS.on_hold
  const location = [project.city, project.state].filter(Boolean).join(', ')
  const hasCover = !!project.cover_image_path

  return (
    <div className="group relative bg-surface border border-[var(--border)] rounded-card overflow-hidden hover:border-[var(--border-strong)] transition-all duration-200 hover:shadow-md flex flex-col">
      {/* Cover image or color bar */}
      {hasCover ? (
        <div className="relative h-28 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverUrl(project.cover_image_path!)}
            alt={project.name}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
          <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-2">
            <h3 className="text-sm font-bold text-white leading-snug line-clamp-1 drop-shadow">
              {project.name}
            </h3>
            {statusBadge(project.status, t)}
          </div>
        </div>
      ) : (
        <>
          <div className={`h-1 w-full ${colors.bar} opacity-70`} />
          <div className="px-4 pt-3 pb-1 flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-primary leading-snug line-clamp-2 flex-1">
              {project.name}
            </h3>
            {statusBadge(project.status, t)}
          </div>
        </>
      )}

      {/* Card body */}
      <div className={`px-4 flex flex-col gap-2.5 flex-1 ${hasCover ? 'pt-3' : 'pt-1'}`}>
        <div className="space-y-1.5">
          {location && (
            <div className="flex items-center gap-1.5">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-tertiary flex-shrink-0">
                <path fillRule="evenodd" d="M8 1a5 5 0 00-5 5c0 2.76 2.13 5.3 4.35 7.1a1 1 0 001.3 0C10.87 11.3 13 8.76 13 6A5 5 0 008 1zm0 6.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" clipRule="evenodd" />
              </svg>
              <span className="text-xs text-secondary truncate">{location}</span>
            </div>
          )}
          {project.hotel_name && (
            <div className="flex items-center gap-1.5">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-tertiary flex-shrink-0">
                <path d="M2 2a2 2 0 012-2h8a2 2 0 012 2v12H2V2zm4 1v2H4V3h2zm0 3v2H4V6h2zm0 3v2H4V9h2zm4-6v2H8V3h2zm0 3v2H8V6h2zm0 3v2H8V9h2zM6 13v1H4v-1h2zm6 1h-2v-1h2v1z"/>
              </svg>
              <span className="text-xs text-secondary truncate">{project.hotel_name}</span>
            </div>
          )}
          {leader && (
            <div className="flex items-center gap-1.5">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-tertiary flex-shrink-0">
                <path fillRule="evenodd" d="M8 8a3 3 0 100-6 3 3 0 000 6zm-5 6a5 5 0 0110 0H3z" clipRule="evenodd" />
              </svg>
              <span className="text-xs text-secondary truncate">{leader.full_name}</span>
            </div>
          )}
          {project.client_name && (
            <div className="flex items-center gap-1.5">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-tertiary flex-shrink-0">
                <path fillRule="evenodd" d="M3 2a2 2 0 012-2h6a2 2 0 012 2v12a1 1 0 01-1 1H4a1 1 0 01-1-1V2zm3 1h4v1H6V3zm2 5a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span className="text-xs text-secondary truncate">{project.client_name}</span>
            </div>
          )}
          {project.budget != null && (
            <div className="flex items-center gap-1.5">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-tertiary flex-shrink-0">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm.75 4.75V5h-1.5v.75H6a.75.75 0 000 1.5h.75v1H6a.75.75 0 000 1.5h.75V10h1.5v-.25H10a.75.75 0 000-1.5h-.75v-1H10a.75.75 0 000-1.5H8.75z"/>
              </svg>
              <span className="text-xs font-semibold text-primary">${Number(project.budget).toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 flex items-center justify-between border-t border-[var(--border)] mt-2">
        <span className="text-[11px] text-tertiary">
          {new Date(project.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        {/* relative z-10 keeps the pencil and arrow above the whole-card link below */}
        <div className="relative z-10 flex items-center gap-1">
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onEdit(project) }}
            className="p-1.5 rounded-button text-tertiary hover:text-primary hover:bg-surface-elevated transition-colors"
            title={t('admin.projects.editTooltip')}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path d="M11.013 2.508a1.75 1.75 0 012.475 2.474L5.87 12.6l-3.371.749.749-3.371 7.765-7.47z"/>
            </svg>
          </button>
          <Link
            href={`/admin/projects/${project.id}`}
            className="p-1.5 rounded-button text-tertiary hover:text-brand hover:bg-brand/10 transition-colors"
            title={t('admin.projects.viewDetailTooltip')}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
              <path fillRule="evenodd" d="M5.293 2.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L9.586 8 5.293 3.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </Link>
        </div>
      </div>

      {/* Makes the whole card open the project, not just the small arrow */}
      <Link
        href={`/admin/projects/${project.id}`}
        aria-label={project.name}
        className="absolute inset-0 rounded-card"
      />
    </div>
  )
}

export default function ProjectsPage() {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const [projects, setProjects] = useState<Project[]>([])
  const [employees, setEmployees] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  // Cover photo
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState<string | null>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  const STATUS_OPTIONS = [
    { value: 'active', label: t('common.active') },
    { value: 'completed', label: t('common.completed') },
    { value: 'on_hold', label: t('admin.projects.statusOnHold') },
  ]

  const load = useCallback(async () => {
    const supabase = createClient()
    const [{ data: projs }, { data: emps }] = await Promise.all([
      supabase.from('projects').select('id, name, status, city, state, hotel_name, leader_id, budget, client_name, client_email, created_at, cover_image_path').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('profiles').select('id, full_name').eq('company_id', companyId).eq('status', 'active').order('full_name'),
    ])
    setProjects((projs ?? []) as Project[])
    setEmployees(emps ?? [])
    setLoading(false)
  }, [companyId])

  useEffect(() => { load() }, [load])

  // Lock background scroll while the modal is open — otherwise dragging
  // inside the form also scrolls the page behind it.
  useEffect(() => {
    if (!showModal) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [showModal])

  function openAdd() {
    setEditing(null)
    setForm({ ...BLANK })
    setError('')
    setCoverFile(null)
    setCoverPreview(null)
    setShowModal(true)
  }

  function openEdit(p: Project) {
    setEditing(p)
    setForm({
      name: p.name,
      status: p.status,
      city: p.city ?? '',
      state: p.state ?? '',
      hotel_name: p.hotel_name ?? '',
      leader_id: p.leader_id ?? '',
      budget: p.budget != null ? String(p.budget) : '',
      client_name: p.client_name ?? '',
      client_email: p.client_email ?? '',
    })
    setError('')
    setCoverFile(null)
    setCoverPreview(p.cover_image_path ? coverUrl(p.cover_image_path) : null)
    setShowModal(true)
  }

  function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
    e.target.value = ''
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    const supabase = createClient()

    let coverImagePath: string | undefined = undefined

    // Upload cover photo first if selected
    if (coverFile) {
      const projectId = editing?.id ?? crypto.randomUUID()
      const ext = coverFile.name.split('.').pop() ?? 'jpg'
      const path = `covers/${projectId}.${ext}`
      const { error: upErr } = await supabase.storage.from('project-photos').upload(path, coverFile, { upsert: true })
      if (!upErr) {
        coverImagePath = path
      } else writeFailed(upErr, 'upload the cover photo (the project will be saved without it)')
    }

    const payload: Record<string, unknown> = {
      name: form.name,
      status: form.status,
      city: form.city || null,
      state: form.state || null,
      hotel_name: form.hotel_name || null,
      leader_id: form.leader_id || null,
      budget: form.budget ? Number(form.budget) : null,
      client_name: form.client_name || null,
      client_email: form.client_email ? form.client_email.trim().toLowerCase() : null,
    }
    if (coverImagePath !== undefined) payload.cover_image_path = coverImagePath

    if (editing) {
      const { error: saveErr } = await supabase.from('projects').update(payload).eq('id', editing.id)
      if (saveErr) { setError(saveErr.message); setSaving(false); return }
    } else {
      const { allowed, limit } = await checkProjectLimit(supabase, companyId)
      if (!allowed) {
        setError(t('admin.projects.planLimitError').replace('{n}', String(limit)))
        setSaving(false)
        return
      }
      const { error: saveErr } = await supabase.from('projects').insert({ ...payload, company_id: companyId })
      if (saveErr) { setError(saveErr.message); setSaving(false); return }
    }
    setSaving(false)
    setShowModal(false)
    load()
  }

  const stateOptions = [
    { value: '', label: t('admin.projects.selectState') },
    ...US_STATES.map(s => ({ value: s, label: s })),
  ]

  const leaderOptions = [
    { value: '', label: t('admin.projects.noLeaderAssigned') },
    ...employees.map(e => ({ value: e.id, label: e.full_name })),
  ]

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.city ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (p.state ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const active = projects.filter(p => p.status === 'active').length

  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      <div className="mb-6 md:mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{t('admin.projects.title')}</h1>
          <p className="text-sm text-secondary mt-1">
            {t('admin.projects.summary').replace('{n}', String(active)).replace('{m}', String(projects.length))}
          </p>
        </div>
        <Button onClick={openAdd}>{t('admin.projects.addProject')}</Button>
      </div>

      <div className="mb-5">
        <Input
          placeholder={t('admin.projects.searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-surface border border-[var(--border)] rounded-card h-52 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-14 h-14 rounded-full bg-brand/10 flex items-center justify-center mb-4">
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 text-brand">
              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
            </svg>
          </div>
          <p className="text-sm font-medium text-primary mb-1">
            {projects.length === 0 ? t('admin.projects.noProjectsYet') : t('admin.projects.noResults')}
          </p>
          {projects.length === 0 && (
            <Button onClick={openAdd} className="mt-4">{t('admin.projects.addProject')}</Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              leader={employees.find(e => e.id === p.leader_id)}
              onEdit={openEdit}
              t={t}
            />
          ))}
        </div>
      )}

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
                {editing ? t('admin.projects.editProject') : t('admin.projects.addProjectTitle')}
              </h2>
              <form onSubmit={handleSave} className="space-y-4">

                {/* Cover photo */}
                <div>
                  <label className="block text-xs font-medium text-secondary mb-2">Cover Photo</label>
                  {coverPreview ? (
                    <div className="relative rounded-input overflow-hidden h-32 bg-surface-elevated">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={coverPreview} alt="cover" className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => { setCoverFile(null); setCoverPreview(null) }}
                        className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-black/80 transition-colors"
                      >✕</button>
                      <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        className="absolute bottom-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded-button hover:bg-black/80 transition-colors"
                      >Change</button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => coverInputRef.current?.click()}
                      className="w-full h-24 border-2 border-dashed border-[var(--border)] rounded-input flex flex-col items-center justify-center gap-1.5 hover:border-brand/40 transition-colors bg-surface-elevated/50"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 text-tertiary">
                        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                      </svg>
                      <span className="text-xs text-tertiary">Add cover photo</span>
                    </button>
                  )}
                  <input ref={coverInputRef} type="file" accept="image/*" className="sr-only" onChange={handleCoverChange} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Input
                      label={t('admin.projects.projectName')}
                      required
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    />
                  </div>
                  <Input
                    label={t('admin.projects.city')}
                    placeholder={t('admin.projects.cityPlaceholder')}
                    value={form.city}
                    onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                  />
                  <Select
                    label={t('admin.projects.state')}
                    options={stateOptions}
                    value={form.state}
                    onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                  />
                  <div className="col-span-2">
                    <Input
                      label={t('admin.projects.hotelAccommodation')}
                      placeholder={t('admin.projects.hotelPlaceholder')}
                      value={form.hotel_name}
                      onChange={e => setForm(f => ({ ...f, hotel_name: e.target.value }))}
                    />
                  </div>
                  <Select
                    label={t('admin.projects.leader')}
                    options={leaderOptions}
                    value={form.leader_id}
                    onChange={e => setForm(f => ({ ...f, leader_id: e.target.value }))}
                  />
                  <Select
                    label={t('admin.projects.status')}
                    options={STATUS_OPTIONS}
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  />
                  <div className="col-span-2">
                    <Input
                      label={t('admin.projects.budget')}
                      type="number"
                      min="0"
                      step="any"
                      placeholder={t('admin.projects.budgetPlaceholder')}
                      value={form.budget}
                      onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
                    />
                  </div>
                  <div className="col-span-2 pt-2 border-t border-[var(--border)]">
                    <p className="text-xs font-medium text-secondary mb-3">{t('admin.projects.clientAccess')}</p>
                  </div>
                  <Input
                    label={t('admin.projects.clientHotelName')}
                    placeholder={t('admin.projects.clientHotelPlaceholder')}
                    value={form.client_name}
                    onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
                  />
                  <Input
                    label={t('admin.projects.clientLoginEmail')}
                    type="email"
                    placeholder={t('admin.projects.clientEmailPlaceholder')}
                    value={form.client_email}
                    onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))}
                  />
                </div>
                <p className="text-xs text-tertiary -mt-2">
                  {t('admin.projects.clientAccessHint')}
                </p>
                {error && (
                  <div className="bg-danger/10 border border-danger/20 rounded-input px-4 py-3 text-sm text-danger">
                    {error}
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <Button type="button" variant="secondary" onClick={() => setShowModal(false)} className="flex-1">
                    {t('common.cancel')}
                  </Button>
                  <Button type="submit" loading={saving} className="flex-1">
                    {editing ? t('admin.projects.saveChanges') : t('admin.projects.addProjectTitle')}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
