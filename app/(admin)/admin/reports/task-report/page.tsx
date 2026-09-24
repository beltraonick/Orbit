import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/session'
import PrintButton from './PrintButton'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

function photoUrl(path: string, bucket: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default async function TaskReportPage({
  searchParams,
}: {
  searchParams: { project?: string }
}) {
  const user = getCurrentUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const projectId = searchParams.project

  type ProjectRow = {
    id: string
    name: string
    address: string | null
    description: string | null
    start_date: string | null
    end_date: string | null
    status: string
    cover_photo_path: string | null
    client_name: string | null
    progress: number | null
  }

  type PhotoRow = {
    id: string
    task_id: string
    storage_path: string
    photo_category: string | null
    uploaded_by_name: string | null
    created_at: string
  }

  // Fetch all projects for this company so user can select one
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, address, description, start_date, end_date, status, cover_photo_path:cover_image_path, client_name, progress')
    .eq('company_id', user.company_id)
    .order('name') as { data: ProjectRow[] | null }

  // Fetch company info
  const { data: company } = await supabase
    .from('companies')
    .select('name, default_hourly_rate')
    .eq('id', user.company_id)
    .single()

  const companyName = company?.name ?? 'Upper Construction'

  if (!projectId) {
    // Project picker screen
    return (
      <div className="p-8 max-w-2xl">
        <h1 className="text-xl font-bold text-primary mb-2">Relatório de Tarefas</h1>
        <p className="text-sm text-secondary mb-6">Selecione um projeto para gerar o relatório PDF.</p>
        <div className="space-y-2">
          {(projects ?? []).map(p => (
            <a
              key={p.id}
              href={`/admin/reports/task-report?project=${p.id}`}
              className="block p-4 rounded-card border border-[var(--border)] bg-surface hover:bg-surface-elevated transition-colors"
            >
              <p className="text-sm font-medium text-primary">{p.name}</p>
              {p.address && <p className="text-xs text-secondary mt-0.5">{p.address}</p>}
            </a>
          ))}
        </div>
      </div>
    )
  }

  const project = (projects ?? []).find(p => p.id === projectId)
  if (!project) redirect('/admin/reports/task-report')

  // Fetch tasks with checklist
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, status, area, priority, estimated_hours, due_date, checklist, notes, assigned_to, assigned_employee:assigned_to(full_name), completed_at, created_at')
    .eq('project_id', projectId)
    .eq('company_id', user.company_id)
    .order('created_at', { ascending: true })

  // Fetch task photos
  const taskIds = (tasks ?? []).map(t => t.id)
  const { data: allPhotos } = taskIds.length > 0
    ? await supabase
        .from('task_media')
        .select('id, task_id, storage_path, photo_category, uploaded_by_name, created_at')
        .in('task_id', taskIds)
        .eq('media_type', 'photo')
        .order('created_at', { ascending: true }) as { data: PhotoRow[] | null }
    : { data: [] as PhotoRow[] }

  const photosByTask: Record<string, PhotoRow[]> = {}
  for (const photo of allPhotos ?? []) {
    if (!photosByTask[photo.task_id]) photosByTask[photo.task_id] = []
    photosByTask[photo.task_id].push(photo)
  }

  const now = new Date()
  const reportDate = now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' } as Intl.DateTimeFormatOptions)

  const totalTasks = (tasks ?? []).length
  const completedTasks = (tasks ?? []).filter(t => t.status === 'completed').length
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; break-before: page; }
          .avoid-break { page-break-inside: avoid; break-inside: avoid; }
          nav, aside, header, [class*="Sidebar"], [class*="sidebar"],
          [class*="md\\:ml-"], .md\\:ml-\\[240px\\] { margin-left: 0 !important; }
          div.flex.h-screen { display: block !important; height: auto !important; overflow: visible !important; }
          main { overflow: visible !important; padding-top: 0 !important; padding-bottom: 0 !important; }
        }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; background: #fff; }
        .cover { min-height: 100vh; display: flex; flex-direction: column; padding: 48px; background: #fff; }
        .cover-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 48px; }
        .cover-logo { display: flex; align-items: center; gap: 12px; }
        .cover-logo img { width: 48px; height: 48px; border-radius: 10px; object-fit: cover; }
        .cover-company { font-size: 18px; font-weight: 700; color: #111; }
        .cover-title { font-size: 13px; color: #666; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 600; margin-bottom: 8px; }
        .cover-project-name { font-size: 36px; font-weight: 800; color: #111; line-height: 1.1; margin-bottom: 12px; }
        .cover-address { font-size: 15px; color: #555; margin-bottom: 24px; }
        .cover-photo { width: 100%; height: 320px; object-fit: cover; border-radius: 12px; margin-bottom: 32px; background: #f0f0f0; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 32px; }
        .info-block { }
        .info-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #999; font-weight: 600; margin-bottom: 4px; }
        .info-value { font-size: 14px; color: #111; font-weight: 500; }
        .cover-footer { margin-top: auto; border-top: 1px solid #e5e5e5; padding-top: 16px; display: flex; justify-content: space-between; align-items: center; }
        .cover-footer-text { font-size: 11px; color: #999; }
        .task-page { padding: 40px 48px; background: #fff; }
        .task-page-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid #e5e5e5; margin-bottom: 20px; }
        .task-page-header-brand { display: flex; align-items: center; gap: 10px; }
        .task-page-header-brand img { width: 28px; height: 28px; border-radius: 6px; }
        .task-page-header-brand span { font-size: 12px; font-weight: 600; color: #555; }
        .task-page-header-project { font-size: 11px; color: #999; }
        .task-title { font-size: 22px; font-weight: 700; color: #111; margin-bottom: 12px; }
        .task-meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px; background: #f8f8f8; border-radius: 10px; padding: 16px; }
        .task-meta-item .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #999; margin-bottom: 2px; }
        .task-meta-item .value { font-size: 13px; color: #111; font-weight: 600; }
        .status-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
        .status-completed { background: #dcfce7; color: #166534; }
        .status-in_progress { background: #fef9c3; color: #854d0e; }
        .status-pending { background: #f3f4f6; color: #374151; }
        .section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #999; font-weight: 600; margin-bottom: 10px; margin-top: 20px; }
        .checklist { list-style: none; padding: 0; margin: 0; }
        .checklist li { display: flex; gap: 10px; padding: 7px 0; border-bottom: 1px solid #f0f0f0; font-size: 13px; align-items: flex-start; }
        .checklist li:last-child { border-bottom: none; }
        .check-num { color: #bbb; font-size: 11px; min-width: 20px; font-weight: 600; padding-top: 1px; }
        .check-icon { color: #16a34a; font-size: 14px; min-width: 18px; }
        .check-pending-icon { color: #d1d5db; font-size: 14px; min-width: 18px; }
        .check-text { flex: 1; color: #111; }
        .check-meta { font-size: 10px; color: #999; white-space: nowrap; }
        .photo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px; }
        .photo-item { }
        .photo-item img { width: 100%; height: 180px; object-fit: cover; border-radius: 8px; background: #f0f0f0; display: block; }
        .photo-caption { font-size: 10px; color: #999; margin-top: 4px; }
        .notes-text { font-size: 13px; color: #444; line-height: 1.6; background: #f8f8f8; border-radius: 8px; padding: 12px; }
        .page-footer { margin-top: 32px; border-top: 1px solid #e5e5e5; padding-top: 12px; display: flex; justify-content: space-between; font-size: 10px; color: #bbb; }
        .print-btn-bar { position: fixed; bottom: 24px; right: 24px; z-index: 100; display: flex; gap: 8px; }
        @media print { .print-btn-bar { display: none; } }
      `}</style>

      {/* Print button (client component) */}
      <PrintButton projectName={project.name} />

      {/* ── COVER PAGE ── */}
      <div className="cover">
        <div className="cover-header">
          <div className="cover-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="logo" />
            <span className="cover-company">{companyName}</span>
          </div>
          <div style={{ textAlign: 'right', fontSize: '12px', color: '#999' }}>
            <div style={{ fontWeight: 600, color: '#555' }}>RELATÓRIO DE TAREFAS</div>
            <div>{reportDate}</div>
          </div>
        </div>

        {project.cover_photo_path && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl(project.cover_photo_path, 'project-photos')}
            alt={project.name}
            className="cover-photo"
          />
        )}

        <div className="cover-title">Projeto</div>
        <div className="cover-project-name">{project.name}</div>
        {project.address && <div className="cover-address">{project.address}</div>}
        {project.description && (
          <p style={{ fontSize: '14px', color: '#555', marginBottom: '24px', lineHeight: '1.6' }}>
            {project.description}
          </p>
        )}

        <div className="info-grid">
          <div className="info-block">
            <div className="info-label">Informações do Projeto</div>
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div className="info-value">Início: {fmtDate(project.start_date)}</div>
              <div className="info-value">Conclusão: {fmtDate(project.end_date)}</div>
              <div className="info-value">Status: {project.status === 'active' ? 'Ativo' : project.status === 'completed' ? 'Concluído' : 'Em Espera'}</div>
            </div>
          </div>
          <div className="info-block">
            <div className="info-label">Informações do Relatório</div>
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div className="info-value">Data: {fmtDate(now.toISOString())}</div>
              <div className="info-value">Total de tarefas: {totalTasks}</div>
              <div className="info-value">Concluídas: {completedTasks} ({progress}%)</div>
            </div>
          </div>
        </div>

        <div className="cover-footer">
          <span className="cover-footer-text">Gerado por OrbitOps</span>
          <span className="cover-footer-text">{companyName} · {reportDate}</span>
        </div>
      </div>

      {/* ── TASK PAGES ── */}
      {(tasks ?? []).map((task, idx) => {
        const taskPhotos = photosByTask[task.id] ?? []
        const checklist: { text: string; done: boolean }[] = task.checklist ?? []
        const assigneeName = (task.assigned_employee as { full_name?: string } | null)?.full_name ?? '—'

        return (
          <div key={task.id} className={`task-page ${idx > 0 ? 'page-break' : 'page-break'}`}>
            {/* Per-page header */}
            <div className="task-page-header">
              <div className="task-page-header-brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icon.png" alt="logo" />
                <span>{companyName}</span>
              </div>
              <span className="task-page-header-project">{project.name}</span>
            </div>

            {/* Task title */}
            <div className="task-title">{task.title}</div>

            {/* Meta grid */}
            <div className="task-meta">
              <div className="task-meta-item">
                <div className="label">Responsável</div>
                <div className="value">{assigneeName}</div>
              </div>
              <div className="task-meta-item">
                <div className="label">Área / Categoria</div>
                <div className="value">{task.area ?? '—'}</div>
              </div>
              <div className="task-meta-item">
                <div className="label">Status</div>
                <div className="value">
                  <span className={`status-badge status-${task.status}`}>
                    {task.status === 'completed' ? 'Concluída' : task.status === 'in_progress' ? 'Em andamento' : 'Pendente'}
                  </span>
                </div>
              </div>
              <div className="task-meta-item">
                <div className="label">Horas estimadas</div>
                <div className="value">{task.estimated_hours != null ? `${task.estimated_hours}h` : '—'}</div>
              </div>
              <div className="task-meta-item">
                <div className="label">Data limite</div>
                <div className="value">{fmtDate(task.due_date)}</div>
              </div>
              <div className="task-meta-item">
                <div className="label">Progresso do checklist</div>
                <div className="value">
                  {checklist.filter(c => c.done).length}/{checklist.length}
                </div>
              </div>
            </div>

            {/* Checklist */}
            {checklist.length > 0 && (
              <>
                <div className="section-title">Checklist</div>
                <ul className="checklist avoid-break">
                  {checklist.map((item, i) => (
                    <li key={i}>
                      <span className="check-num">{i + 1}.</span>
                      <span className={item.done ? 'check-icon' : 'check-pending-icon'}>
                        {item.done ? '✓' : '○'}
                      </span>
                      <span className="check-text" style={{ textDecoration: item.done ? 'line-through' : 'none', color: item.done ? '#888' : '#111' }}>
                        {item.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* Notes */}
            {task.notes && (
              <>
                <div className="section-title">Observações</div>
                <div className="notes-text avoid-break">{task.notes}</div>
              </>
            )}

            {/* Photos */}
            {taskPhotos.length > 0 && (
              <>
                <div className="section-title">Fotos ({taskPhotos.length})</div>
                <div className="photo-grid">
                  {taskPhotos.map(photo => (
                    <div key={photo.id} className="photo-item avoid-break">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoUrl(photo.storage_path, 'task-photos')}
                        alt="Task photo"
                      />
                      <div className="photo-caption">
                        {photo.photo_category && <span style={{ textTransform: 'capitalize', marginRight: '6px' }}>{photo.photo_category}</span>}
                        {fmtDateTime(photo.created_at)}
                        {photo.uploaded_by_name && <span> · {photo.uploaded_by_name}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Page footer */}
            <div className="page-footer">
              <span>{companyName} · {project.name}</span>
              <span>Tarefa {idx + 1} de {totalTasks}</span>
            </div>
          </div>
        )
      })}
    </>
  )
}
