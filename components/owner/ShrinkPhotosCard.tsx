'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/lib/i18n/LocaleContext'

// Owner dashboard: shrink photos already in storage (see /api/owner/photos).
// Works in small batches so it never times out, and shows the progress.

interface Candidate { bucket: string; path: string; size: number }
type Result = { status: 'shrunk' | 'skipped' | 'error'; before?: number; after?: number }

const BATCH = 5
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

export function ShrinkPhotosCard() {
  const { t } = useTranslation()
  const s = (key: string, vars: Record<string, string | number> = {}) =>
    Object.entries(vars).reduce((acc, [k, v]) => acc.split(`{${k}}`).join(String(v)), t(`owner.dashboard.${key}`))

  const [phase, setPhase] = useState<'idle' | 'scanning' | 'ready' | 'running' | 'done'>('idle')
  const [files, setFiles] = useState<Candidate[]>([])
  const [totalBytes, setTotalBytes] = useState(0)
  const [done, setDone] = useState(0)
  const [shrunk, setShrunk] = useState(0)
  const [freed, setFreed] = useState(0)
  const [errors, setErrors] = useState(0)
  const [error, setError] = useState('')

  async function scan() {
    setError('')
    setPhase('scanning')
    const res = await fetch('/api/owner/photos')
    if (!res.ok) { setError('Could not list photos.'); setPhase('idle'); return }
    const data = (await res.json()) as { files: Candidate[]; totalBytes: number }
    setFiles(data.files)
    setTotalBytes(data.totalBytes)
    setPhase('ready')
  }

  async function run() {
    if (!window.confirm(s('shrinkConfirm', { n: files.length }))) return
    setPhase('running')
    setDone(0); setShrunk(0); setFreed(0); setErrors(0)
    let d = 0, n = 0, f = 0, e = 0
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH).map(({ bucket, path }) => ({ bucket, path }))
      try {
        const res = await fetch('/api/owner/photos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: batch }),
        })
        const data = res.ok ? ((await res.json()) as { results: Result[] }) : { results: batch.map(() => ({ status: 'error' as const })) }
        for (const r of data.results) {
          if (r.status === 'shrunk') { n++; f += (r.before ?? 0) - (r.after ?? 0) }
          if (r.status === 'error') e++
        }
      } catch {
        e += batch.length
      }
      d += batch.length
      setDone(d); setShrunk(n); setFreed(f); setErrors(e)
    }
    setPhase('done')
  }

  return (
    <Card className="mb-6 md:mb-8">
      <h2 className="text-sm font-semibold text-primary">{s('shrinkTitle')}</h2>
      <p className="text-xs text-secondary mt-1">{s('shrinkDesc')}</p>
      {error && <p className="text-xs text-danger mt-2">{error}</p>}

      <div className="mt-3 space-y-2">
        {(phase === 'idle' || phase === 'scanning') && (
          <Button variant="secondary" onClick={scan} loading={phase === 'scanning'}>
            {phase === 'scanning' ? s('shrinkScanning') : s('shrinkScan')}
          </Button>
        )}
        {phase === 'ready' && (
          files.length === 0
            ? <p className="text-sm text-secondary">{s('shrinkNone')}</p>
            : <>
                <p className="text-sm text-primary">{s('shrinkFound', { n: files.length, mb: mb(totalBytes) })}</p>
                <Button onClick={run}>{s('shrinkStart')}</Button>
              </>
        )}
        {phase === 'running' && (
          <>
            <p className="text-sm text-primary">{s('shrinkProgress', { done, total: files.length })}</p>
            <div className="h-2 rounded-full bg-surface-elevated overflow-hidden">
              <div className="h-full bg-brand transition-all" style={{ width: `${files.length ? (done / files.length) * 100 : 0}%` }} />
            </div>
          </>
        )}
        {phase === 'done' && (
          <>
            <p className="text-sm text-green">✓ {s('shrinkDone', { n: shrunk, mb: mb(freed) })}</p>
            {errors > 0 && <p className="text-xs text-secondary">{s('shrinkErrors', { n: errors })}</p>}
          </>
        )}
      </div>
    </Card>
  )
}
