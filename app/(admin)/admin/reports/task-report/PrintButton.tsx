'use client'

import { SharePdfButton } from '@/components/SharePdfButton'
import { useTranslation } from '@/lib/i18n/LocaleContext'

// Floating actions for the task report. On a phone they sit above the bottom
// menu bar (they used to cover it). "Exportar PDF" builds a real PDF file and
// opens the share sheet — window.print() does nothing in the iPhone
// home-screen app; "Imprimir" stays for computers.
export default function PrintButton({ projectName }: { projectName: string }) {
  const { t } = useTranslation()
  const fileName = `relatorio-${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tarefas'}.pdf`
  return (
    <div
      data-pdf-ignore
      className="fixed right-4 md:right-6 z-[100] flex flex-wrap justify-end items-center gap-2 bottom-[calc(84px+env(safe-area-inset-bottom))] md:bottom-6 print:hidden"
    >
      <a
        href="/admin/reports/task-report"
        style={{
          padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: 'var(--surface-elevated)', border: '1px solid var(--border)',
          color: 'var(--text-secondary)', textDecoration: 'none', cursor: 'pointer',
        }}
      >
        ← Voltar
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="hidden md:inline-block"
        style={{
          padding: '10px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: '#fff', color: '#333', border: '1px solid #ddd', cursor: 'pointer',
        }}
      >
        Imprimir
      </button>
      <SharePdfButton
        target="#task-report-root"
        fileName={fileName}
        style={{
          padding: '10px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          background: '#D61B0E', color: '#fff', border: 'none', cursor: 'pointer',
        }}
        labels={{
          build: t('common.pdf.build'), building: t('common.pdf.building'), share: t('common.pdf.share'),
          open: t('common.pdf.open'), error: t('common.pdf.error'),
        }}
      />
    </div>
  )
}
