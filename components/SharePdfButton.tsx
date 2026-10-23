'use client'

import { useState, useEffect } from 'react'

// Turns an on-screen report into a real PDF file and hands it to the phone's
// share sheet (save to Files, WhatsApp, Mail, Print…).
//
// Why not window.print(): it does nothing in an iPhone home-screen app or
// inside the iOS app, which is where most people open OrbitOps.
//
// Two taps on purpose: building the PDF takes a few seconds, and iOS only
// opens the share sheet from a direct tap — so the first tap builds the file
// and the second one shares it. "Open PDF" is the fallback when the phone or
// browser can't share files (it opens the PDF, which has its own share/print).

interface Props {
  /** CSS selector of the element to turn into the PDF. */
  target: string
  /** File name, e.g. "payment-receipt.pdf". */
  fileName: string
  className?: string
  style?: React.CSSProperties
  labels?: { build?: string; building?: string; share?: string; open?: string; error?: string }
}

// iOS Safari refuses canvases above ~16.7M pixels (they render blank).
const MAX_CANVAS_PIXELS = 16_000_000

async function buildPdf(target: HTMLElement, fileName: string): Promise<File> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])

  const width = target.scrollWidth
  const height = target.scrollHeight
  const scale = Math.min(2, Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height)))

  const canvas = await html2canvas(target, {
    scale,
    useCORS: true, // project/receipt photos come from Supabase storage
    backgroundColor: '#ffffff',
    width,
    height,
    windowWidth: Math.max(width, document.documentElement.clientWidth),
    windowHeight: height,
    scrollX: 0,
    scrollY: 0,
    ignoreElements: el => el.hasAttribute('data-pdf-ignore'),
    logging: false,
  })

  // A4 portrait, the long image sliced into pages.
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 8
  const contentW = pageW - margin * 2
  const contentH = pageH - margin * 2
  const pxPerMm = canvas.width / contentW
  const pageHeightPx = Math.floor(contentH * pxPerMm)

  const slice = document.createElement('canvas')
  slice.width = canvas.width
  const ctx = slice.getContext('2d')
  if (!ctx) throw new Error('Canvas not available')

  for (let y = 0, page = 0; y < canvas.height; y += pageHeightPx, page++) {
    const h = Math.min(pageHeightPx, canvas.height - y)
    slice.height = h
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, slice.width, h)
    ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h)
    if (page > 0) pdf.addPage()
    pdf.addImage(slice.toDataURL('image/jpeg', 0.9), 'JPEG', margin, margin, contentW, h / pxPerMm)
  }

  const blob = pdf.output('blob')
  return new File([blob], fileName, { type: 'application/pdf' })
}

export function SharePdfButton({ target, fileName, className, style, labels = {} }: Props) {
  const [state, setState] = useState<'idle' | 'building' | 'ready' | 'error'>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const canShareFile = (f: File) => {
    try {
      return typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [f] })
    } catch {
      return false
    }
  }

  async function build() {
    const el = document.querySelector(target) as HTMLElement | null
    if (!el) { setState('error'); return }
    setState('building')
    try {
      const f = await buildPdf(el, fileName)
      setFile(f)
      setUrl(URL.createObjectURL(f))
      setState('ready')
    } catch (err) {
      console.error('[pdf]', err)
      setState('error')
    }
  }

  async function share() {
    if (!file) return
    try {
      await navigator.share({ files: [file], title: fileName })
    } catch (err) {
      // User closed the share sheet — not an error.
      if ((err as Error)?.name !== 'AbortError' && url) window.open(url, '_blank')
    }
  }

  const l = {
    build: labels.build ?? '📄 Generate PDF',
    building: labels.building ?? 'Generating PDF…',
    share: labels.share ?? '📤 Share / Save PDF',
    open: labels.open ?? 'Open PDF',
    error: labels.error ?? 'Could not generate the PDF. Try again.',
  }

  return (
    <span data-pdf-ignore className="inline-flex flex-wrap items-center gap-2">
      {state !== 'ready' ? (
        <button type="button" onClick={build} disabled={state === 'building'} className={className} style={style}>
          {state === 'building' ? l.building : l.build}
        </button>
      ) : (
        <>
          {file && canShareFile(file) && (
            <button type="button" onClick={share} className={className} style={style}>
              {l.share}
            </button>
          )}
          {url && (
            <a
              href={url}
              download={fileName}
              target="_blank"
              rel="noopener noreferrer"
              className={file && canShareFile(file) ? 'text-sm underline' : className}
              style={file && canShareFile(file) ? { fontSize: 13 } : style}
            >
              {l.open}
            </a>
          )}
        </>
      )}
      {state === 'error' && <span style={{ color: '#D61B0E', fontSize: 12 }}>{l.error}</span>}
    </span>
  )
}
