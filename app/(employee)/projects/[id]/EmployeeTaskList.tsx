'use client'

import { useState, useTransition } from 'react'
import { updateEmployeeTask } from '@/app/actions/employeeTasks'
import { createClient } from '@/lib/supabase/client'
import { PhotoLightbox, type LightboxPhoto } from '@/components/ui/PhotoLightbox'

type ChecklistItem = { text: string; done: boolean }

type Task = {
  id: string
  title: string
  status: string
  area: string | null
  due_date: string | null
  checklist: ChecklistItem[]
  notes: string | null
}

type Props = {
  initialTasks: Task[]
  locale: string
  projectId: string
}

const STATUS_OPTIONS = [
  { value: 'pending',     labelPt: 'Pendente',     labelEn: 'Pending',     labelEs: 'Pendiente' },
  { value: 'in_progress', labelPt: 'Em andamento', labelEn: 'In progress', labelEs: 'En progreso' },
  { value: 'completed',   labelPt: 'Concluído',    labelEn: 'Completed',   labelEs: 'Completado' },
]

function statusLabel(status: string, locale: string) {
  const opt = STATUS_OPTIONS.find(s => s.value === status)
  if (!opt) return status
  return locale === 'pt' ? opt.labelPt : locale === 'es' ? opt.labelEs : opt.labelEn
}

function fmtDate(iso: string, locale: string) {
  const dateLocale = locale === 'pt' ? 'pt-BR' : locale === 'es' ? 'es-ES' : 'en-US'
  return new Date(iso + 'T00:00:00').toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

export function EmployeeTaskList({ initialTasks, locale }: Props) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [editing, setEditing] = useState<Task | null>(null)
  const [editStatus, setEditStatus] = useState('')
  const [editChecklist, setEditChecklist] = useState<ChecklistItem[]>([])
  const [editTitle, setEditTitle] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [taskPhotos, setTaskPhotos] = useState<string[]>([])
  const [photosLoading, setPhotosLoading] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [newCheckItem, setNewCheckItem] = useState('')
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  async function loadPhotos(taskId: string) {
    setPhotosLoading(true)
    setTaskPhotos([])
    try {
      const supabase = createClient()
      const { data } = await supabase
        .from('task_media')
        .select('storage_path')
        .eq('task_id', taskId)
        .eq('media_type', 'photo')
      setTaskPhotos(
        (data ?? []).map(p => `${SUPABASE_URL}/storage/v1/object/public/task-photos/${p.storage_path}`)
      )
    } catch {
      // ignore
    }
    setPhotosLoading(false)
  }

  function openEdit(task: Task) {
    setEditing(task)
    setEditStatus(task.status)
    setEditChecklist((task.checklist ?? []).map(c => ({ ...c })))
    setEditTitle(task.title)
    setEditNotes(task.notes ?? '')
    setNewCheckItem('')
    setSaved(false)
    loadPhotos(task.id)
  }

  function addCheckItem() {
    const text = newCheckItem.trim()
    if (!text) return
    setEditChecklist(prev => [...prev, { text, done: false }])
    setNewCheckItem('')
  }

  function closeEdit() {
    setEditing(null)
    setLightboxIndex(null)
  }

  function toggleCheckItem(index: number) {
    setEditChecklist(prev =>
      prev.map((item, i) => i === index ? { ...item, done: !item.done } : item)
    )
  }

  function handleSave() {
    if (!editing) return
    startTransition(async () => {
      const result = await updateEmployeeTask(editing.id, {
        status: editStatus,
        checklist: editChecklist,
        title: editTitle.trim() || editing.title,
        notes: editNotes,
      })
      if (result.ok) {
        setTasks(prev =>
          prev.map(t =>
            t.id === editing.id
              ? { ...t, status: editStatus, checklist: editChecklist, title: editTitle.trim() || t.title, notes: editNotes }
              : t
          )
        )
        setSaved(true)
        setTimeout(() => closeEdit(), 800)
      }
    })
  }

  const L = {
    save:      locale === 'pt' ? 'Salvar' : 'Save',
    saving:    locale === 'pt' ? 'Salvando…' : 'Saving…',
    saved:     locale === 'pt' ? 'Salvo ✓' : 'Saved ✓',
    status:    'Status',
    checklist: locale === 'pt' ? 'Checklist' : 'Checklist',
    notes:     locale === 'pt' ? 'Notas' : 'Notes',
    notesHint: locale === 'pt' ? 'Adicione uma observação…' : 'Add a note…',
    photos:    locale === 'pt' ? 'Fotos' : 'Photos',
    noPhotos:  locale === 'pt' ? 'Nenhuma foto' : 'No photos',
    taskName:  locale === 'pt' ? 'Nome da tarefa' : 'Task name',
    tapEdit:   locale === 'pt' ? 'Editar' : 'Edit',
    due:       locale === 'pt' ? 'Prazo' : 'Due',
    pending:   locale === 'pt' ? 'pendente' : 'pending',
    completed: locale === 'pt' ? 'concluída' : 'completed',
  }

  const doneTasks = tasks.filter(t => t.status === 'completed').length
  const pendingTasks = tasks.filter(t => t.status !== 'completed').length

  return (
    <>
      {/* Summary */}
      <div className="flex gap-4 text-xs text-secondary mb-5">
        <span>{pendingTasks} {L.pending}{locale === 'pt' && pendingTasks !== 1 ? 's' : ''}</span>
        <span>{doneTasks} {L.completed}{locale === 'pt' && doneTasks !== 1 ? 's' : ''}</span>
      </div>

      {/* Task list */}
      {tasks.length === 0 ? (
        <p className="text-sm text-secondary text-center py-8">
          {locale === 'pt' ? 'Nenhuma tarefa atribuída a você neste projeto.' : 'No tasks assigned to you in this project.'}
        </p>
      ) : (
        <div className="bg-surface rounded-[16px] border border-[var(--border)] divide-y divide-[var(--border)]">
          {tasks.map(task => {
            const doneItems = (task.checklist ?? []).filter(c => c.done).length
            const totalItems = (task.checklist ?? []).length
            const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed'
            return (
              <button
                key={task.id}
                type="button"
                onClick={() => openEdit(task)}
                className="w-full px-4 py-3 flex items-start gap-3 text-left active:bg-surface-elevated transition-colors"
              >
                <div
                  className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    background: task.status === 'completed'
                      ? 'rgb(var(--color-green))'
                      : task.status === 'in_progress'
                        ? 'rgb(var(--color-amber))'
                        : 'color-mix(in srgb, var(--color-secondary) 30%, transparent)',
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium leading-snug ${task.status === 'completed' ? 'text-tertiary line-through' : 'text-primary'}`}>
                    {task.title}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[11px]" style={{
                      color: task.status === 'completed'
                        ? 'rgb(var(--color-green))'
                        : task.status === 'in_progress'
                          ? 'rgb(var(--color-amber))'
                          : undefined,
                    }}>
                      {statusLabel(task.status, locale)}
                    </span>
                    {task.area && <span className="text-[11px] text-tertiary">{task.area}</span>}
                    {totalItems > 0 && <span className="text-[11px] text-tertiary">{doneItems}/{totalItems}</span>}
                    {task.due_date && (
                      <span className={`text-[11px] ${isOverdue ? 'text-danger font-medium' : 'text-tertiary'}`}>
                        {L.due} {fmtDate(task.due_date, locale)}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-[11px] text-brand font-medium flex-shrink-0 mt-0.5">{L.tapEdit}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Edit bottom sheet */}
      {editing && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={closeEdit} />
          <div className="relative bg-surface rounded-t-[20px] max-h-[90vh] overflow-y-auto">
            {/* Handle */}
            <div className="sticky top-0 bg-surface pt-4 pb-3 px-4 z-10 border-b border-[var(--border)]">
              <div className="w-10 h-1 rounded-full bg-[var(--border)] mx-auto mb-3" />
              {/* Editable title */}
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                className="w-full text-base font-semibold text-primary bg-transparent border-0 outline-none placeholder:text-tertiary"
                placeholder={L.taskName}
              />
              {editing.area && <p className="text-xs text-secondary mt-0.5">{editing.area}</p>}
            </div>

            <div className="px-4 pt-4 pb-8 space-y-5">
              {/* Status */}
              <div>
                <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">{L.status}</p>
                <div className="flex gap-2">
                  {STATUS_OPTIONS.map(opt => {
                    const active = editStatus === opt.value
                    const activeColor = opt.value === 'completed'
                      ? 'rgb(var(--color-green))'
                      : opt.value === 'in_progress'
                        ? 'rgb(var(--color-amber))'
                        : 'rgb(var(--color-brand))'
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setEditStatus(opt.value)}
                        className="flex-1 py-2 rounded-[10px] text-xs font-semibold border transition-all"
                        style={active
                          ? { background: activeColor, borderColor: 'transparent', color: 'white' }
                          : { borderColor: 'var(--border)', color: 'var(--color-secondary)' }
                        }
                      >
                        {locale === 'pt' ? opt.labelPt : locale === 'es' ? opt.labelEs : opt.labelEn}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Checklist */}
              <div>
                <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">{L.checklist}</p>
                {editChecklist.length > 0 && (
                  <div className="bg-surface-elevated rounded-[12px] divide-y divide-[var(--border)] mb-2">
                    {editChecklist.map((item, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleCheckItem(i)}
                        className="w-full flex items-center gap-3 px-3 py-3 text-left active:opacity-70"
                      >
                        <div
                          className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                          style={item.done
                            ? { background: 'rgb(var(--color-green))', borderColor: 'transparent' }
                            : { borderColor: 'var(--border)' }
                          }
                        >
                          {item.done && (
                            <svg viewBox="0 0 12 12" fill="none" className="w-3 h-3">
                              <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                        <span className={`text-sm leading-snug flex-1 text-left ${item.done ? 'text-tertiary line-through' : 'text-primary'}`}>
                          {item.text}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {/* Add new item */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCheckItem}
                    onChange={e => setNewCheckItem(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCheckItem()}
                    placeholder={locale === 'pt' ? 'Novo item…' : 'New item…'}
                    className="flex-1 text-sm bg-surface-elevated rounded-[10px] px-3 py-2.5 border border-[var(--border)] outline-none focus:border-brand placeholder:text-tertiary transition-colors"
                  />
                  <button
                    type="button"
                    onClick={addCheckItem}
                    className="px-3 py-2.5 rounded-[10px] text-sm font-semibold text-white"
                    style={{ background: 'rgb(var(--color-brand))' }}
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Notes */}
              <div>
                <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">{L.notes}</p>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  rows={3}
                  placeholder={L.notesHint}
                  className="w-full text-sm text-primary bg-surface-elevated rounded-[12px] px-3 py-3 border border-[var(--border)] outline-none focus:border-brand resize-none placeholder:text-tertiary transition-colors"
                />
              </div>

              {/* Photos */}
              <div>
                <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">{L.photos}</p>
                {photosLoading ? (
                  <p className="text-xs text-tertiary">{locale === 'pt' ? 'Carregando…' : 'Loading…'}</p>
                ) : taskPhotos.length === 0 ? (
                  <p className="text-xs text-tertiary">{L.noPhotos}</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {taskPhotos.map((url, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setLightboxIndex(i)}
                        className="aspect-square rounded-[10px] overflow-hidden bg-surface-elevated active:opacity-70"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Save */}
              <button
                type="button"
                onClick={handleSave}
                disabled={isPending || saved}
                className="w-full py-3.5 rounded-[14px] text-sm font-semibold text-white transition-all disabled:opacity-60"
                style={{ background: saved ? 'rgb(var(--color-green))' : 'rgb(var(--color-brand))' }}
              >
                {saved ? L.saved : isPending ? L.saving : L.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo lightbox */}
      {lightboxIndex != null && (
        <PhotoLightbox
          photos={taskPhotos.map((url): LightboxPhoto => ({ url }))}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  )
}
