'use client'

import { writeFailed } from '@/lib/write-feedback'
import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useCompanyId } from '@/lib/company-context'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { PhotoPicker } from '@/components/ui/PhotoPicker'
import { PhotoLightbox, type LightboxPhoto } from '@/components/ui/PhotoLightbox'

const BUCKET = 'project-photos'

interface PhotoRecord {
  id: string
  project_id: string | null
  employee_id: string | null
  storage_path: string
  caption: string | null
  created_at: string
  url?: string
  project?: { name: string } | null
  profile?: { full_name: string } | null
}

interface Project { id: string; name: string }

export default function PhotosPage() {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const [photos, setPhotos] = useState<PhotoRecord[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [projectFilter, setProjectFilter] = useState('')
  const [selectedProject, setSelectedProject] = useState('')
  const [lightbox, setLightbox] = useState<{ photos: LightboxPhoto[]; index: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()

    const [{ data: projs }, { data: photoRows }] = await Promise.all([
      supabase.from('projects').select('id, name').eq('company_id', companyId).order('name'),
      supabase
        .from('project_photos')
        .select('id, project_id, employee_id, storage_path, caption, created_at, project:project_id(name), profile:employee_id(full_name)')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(100),
    ])

    setProjects(projs ?? [])

    const rows = (photoRows ?? []) as unknown as PhotoRecord[]
    const withUrls = rows.map(r => {
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(r.storage_path)
      return { ...r, url: data.publicUrl }
    })
    setPhotos(withUrls)
    setLoading(false)
  }, [companyId])

  useEffect(() => { load() }, [load])

  async function handleUpload(files: File[]) {
    if (files.length === 0) return
    setUploadProgress({ done: 0, total: files.length })
    const supabase = createClient()

    let failed = 0
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = file.name.split('.').pop()
      const path = `${companyId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file)
      if (uploadErr) { failed++; console.error('[photo-upload]', uploadErr.message) }
      else {
        const { error: insertErr } = await supabase.from('project_photos').insert({
          company_id: companyId,
          project_id: selectedProject || null,
          storage_path: path,
        })
        if (insertErr) { failed++; console.error('[photo-upload]', insertErr.message) }
      }
      setUploadProgress({ done: i + 1, total: files.length })
    }

    setUploadProgress(null)
    if (failed > 0) window.alert(`${failed} of ${files.length} photo(s) could not be uploaded. Please try again.`)
    load()
  }

  async function deletePhoto(photo: PhotoRecord) {
    if (!window.confirm(t('admin.photos.deleteConfirm'))) return
    const supabase = createClient()
    const [, { error }] = await Promise.all([
      supabase.storage.from(BUCKET).remove([photo.storage_path]),
      supabase.from('project_photos').delete().eq('id', photo.id).eq('company_id', companyId),
    ])
    if (writeFailed(error, 'delete this photo')) return
    // Also close lightbox if the deleted photo was open
    setLightbox(null)
    load()
  }

  const projectOptions = [
    { value: '', label: t('admin.photos.allProjects') },
    ...projects.map(p => ({ value: p.id, label: p.name })),
  ]
  const uploadProjectOptions = [
    { value: '', label: t('admin.photos.noProject') },
    ...projects.map(p => ({ value: p.id, label: p.name })),
  ]

  const filtered = projectFilter ? photos.filter(p => p.project_id === projectFilter) : photos

  function openLightbox(index: number) {
    const lbPhotos: LightboxPhoto[] = filtered.map(p => ({
      url: p.url ?? '',
      category: null,
      uploaderName: (p.profile as unknown as { full_name: string } | null)?.full_name ?? null,
      createdAt: p.created_at ?? null,
      projectName: (p.project as unknown as { name: string } | null)?.name ?? null,
      taskTitle: null,
    }))
    setLightbox({ photos: lbPhotos, index })
  }

  return (
    <div className="p-4 md:p-8 max-w-[1400px]">
      <div className="mb-6 md:mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{t('admin.photos.title')}</h1>
          <p className="text-sm text-secondary mt-1">{photos.length} {photos.length !== 1 ? t('admin.photos.photoPlural') : t('admin.photos.photoSingular')}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-44">
            <Select
              options={uploadProjectOptions}
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
            />
          </div>
          <PhotoPicker
            onFiles={handleUpload}
            disabled={uploadProgress !== null}
            trigger={open => (
              <button
                onClick={open}
                disabled={uploadProgress !== null}
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
                  <>+ {t('admin.photos.uploadPhotos')}</>
                )}
              </button>
            )}
          />
        </div>
      </div>

      <div className="mb-4 w-52">
        <Select
          options={projectOptions}
          value={projectFilter}
          onChange={e => setProjectFilter(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-sm text-secondary text-center py-16">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 gap-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-12 h-12 text-tertiary">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
          </svg>
          <p className="text-sm font-medium text-secondary">{t('admin.photos.noPhotosYet')}</p>
          <p className="text-xs text-tertiary">{t('admin.photos.uploadHint')}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filtered.map((photo, idx) => {
            const projectName = (photo.project as unknown as { name: string } | null)?.name
            const uploaderName = (photo.profile as unknown as { full_name: string } | null)?.full_name
            return (
              <div key={photo.id} className="flex flex-col gap-1">
                <div className="relative aspect-square rounded-card overflow-hidden bg-surface-elevated">
                  {photo.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={photo.url}
                      alt={photo.caption ?? t('admin.photos.photoAlt')}
                      className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform duration-200"
                      onClick={() => openLightbox(idx)}
                    />
                  )}
                  {/* Always-visible delete button */}
                  <button
                    onClick={() => deletePhoto(photo)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center hover:bg-danger/80 transition-colors"
                    title={t('common.delete')}
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3 text-white">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
                {/* Always-visible metadata below card */}
                <div className="px-0.5">
                  {projectName && (
                    <p className="text-[11px] font-medium text-secondary truncate">{projectName}</p>
                  )}
                  {uploaderName && (
                    <p className="text-[11px] text-secondary truncate">{uploaderName}</p>
                  )}
                  <p className="text-[10px] text-tertiary">
                    {new Date(photo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          initialIndex={lightbox.index}
          onClose={() => setLightbox(null)}
          onDelete={idx => {
            const photo = filtered[idx]
            if (photo) deletePhoto(photo)
          }}
        />
      )}
    </div>
  )
}
