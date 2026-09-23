'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

export interface LightboxPhoto {
  url: string
  category?: string | null
  uploaderName?: string | null
  createdAt?: string | null
  projectName?: string | null
  taskTitle?: string | null
  canDelete?: boolean
}

interface PhotoLightboxProps {
  photos: LightboxPhoto[]
  initialIndex?: number
  onClose: () => void
  onDelete?: (index: number) => void
}

const CAT: Record<string, { label: string; cls: string }> = {
  before:   { label: 'Before',   cls: 'bg-amber/90 text-white' },
  progress: { label: 'Progress', cls: 'bg-blue/90 text-white' },
  after:    { label: 'After',    cls: 'bg-green/90 text-white' },
}

export function PhotoLightbox({ photos, initialIndex = 0, onClose, onDelete }: PhotoLightboxProps) {
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, photos.length - 1)))
  const [scale, setScale] = useState(1)
  const [drag, setDrag] = useState(0)
  const touchX   = useRef(0)
  const touchY   = useRef(0)
  const pinchRef = useRef(0)
  const scaleRef = useRef(1)
  const dragging = useRef(false)
  const draggingDown = useRef(false)
  const [dragY, setDragY] = useState(0)

  const current = photos[Math.max(0, Math.min(index, photos.length - 1))]

  const goNext = useCallback(() => {
    if (index < photos.length - 1) { setIndex(i => i + 1); setScale(1); setDrag(0) }
  }, [index, photos.length])

  const goPrev = useCallback(() => {
    if (index > 0) { setIndex(i => i - 1); setScale(1); setDrag(0) }
  }, [index])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, goNext, goPrev])

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      touchX.current = e.touches[0].clientX
      touchY.current = e.touches[0].clientY
      dragging.current = false
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinchRef.current = Math.sqrt(dx * dx + dy * dy)
      scaleRef.current = scale
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchRef.current > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.sqrt(dx * dx + dy * dy)
      setScale(Math.min(4, Math.max(1, scaleRef.current * dist / pinchRef.current)))
    } else if (e.touches.length === 1 && scale <= 1) {
      const dx = e.touches[0].clientX - touchX.current
      const dy = e.touches[0].clientY - touchY.current
      if (!draggingDown.current && Math.abs(dx) > Math.abs(dy) + 4) dragging.current = true
      // Swipe down to close — the familiar gesture from the Photos app.
      if (!dragging.current && dy > 8 && dy > Math.abs(dx)) draggingDown.current = true
      if (dragging.current) setDrag(dx)
      if (draggingDown.current) setDragY(Math.max(0, dy))
    }
  }

  function onTouchEnd() {
    if (scale <= 1 && draggingDown.current && dragY > 100) {
      draggingDown.current = false
      setDragY(0)
      onClose()
      return
    }
    draggingDown.current = false
    setDragY(0)
    if (scale <= 1 && dragging.current) {
      if (drag < -60) goNext()
      else if (drag > 60) goPrev()
    }
    setDrag(0)
    dragging.current = false
  }

  function fmtDate(dt: string | null | undefined) {
    if (!dt) return null
    const d = new Date(dt)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' · ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }

  async function share() {
    try {
      if (navigator.share) await navigator.share({ url: current.url })
      else await navigator.clipboard.writeText(current.url)
    } catch { /* cancelled */ }
  }

  if (!current) return null
  const catInfo = CAT[current.category ?? '']

  // Rendered into <body> so a transformed/animated parent (drawers, modals)
  // can never trap this full-screen viewer or push its close button off-screen.
  const viewer = (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col select-none">
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 flex-shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)', paddingBottom: 12 }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center active:bg-white/25 transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-white">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {photos.length > 1 && (
          <span className="text-xs text-white/60 font-medium tabular-nums">{index + 1} / {photos.length}</span>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={share}
            className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20 transition-colors"
            title="Share"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white">
              <path d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z" />
            </svg>
          </button>
          <a
            href={current.url}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center active:bg-white/20 transition-colors"
            title="Download"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-white">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </a>
        </div>
      </div>

      {/* Image */}
      <div
        className="flex-1 relative flex items-center justify-center overflow-hidden"
        style={{ touchAction: 'none' }}
        onClick={e => { if (e.target === e.currentTarget && scale <= 1) onClose() }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {index > 0 && (
          <button
            onClick={goPrev}
            className="absolute left-3 z-10 w-9 h-9 rounded-full bg-white/10 hidden md:flex items-center justify-center hover:bg-white/20 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-white">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </button>
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt=""
          draggable={false}
          className="max-w-full max-h-full object-contain"
          style={{
            transform: `scale(${scale}) translate(${scale <= 1 ? drag : 0}px, ${scale <= 1 ? dragY : 0}px)`,
            transition: drag === 0 && dragY === 0 ? 'transform 0.2s ease' : 'none',
            opacity: dragY > 0 ? Math.max(0.4, 1 - dragY / 400) : 1,
          }}
        />

        {index < photos.length - 1 && (
          <button
            onClick={goNext}
            className="absolute right-3 z-10 w-9 h-9 rounded-full bg-white/10 hidden md:flex items-center justify-center hover:bg-white/20 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-white">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </button>
        )}
      </div>

      {/* Metadata + dots */}
      <div
        className="flex-shrink-0 px-5 pt-4 space-y-1.5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
      >
        <div className="flex items-center gap-2">
          {catInfo && (
            <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide ${catInfo.cls}`}>
              {catInfo.label}
            </span>
          )}
          {onDelete && current.canDelete !== false && (
            <button
              onClick={() => onDelete(index)}
              className="ml-auto flex items-center gap-1.5 text-xs text-danger/70 hover:text-danger transition-colors font-medium"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 000 1.5h.3l.815 8.15A1.5 1.5 0 005.357 15h5.285a1.5 1.5 0 001.493-1.35l.815-8.15h.3a.75.75 0 000-1.5H11v-.75A2.25 2.25 0 008.75 1h-1.5A2.25 2.25 0 005 3.25zm2.25-.75a.75.75 0 00-.75.75V4h3v-.75a.75.75 0 00-.75-.75h-1.5zM6.05 6a.75.75 0 01.787.713l.275 5.5a.75.75 0 01-1.498.075l-.275-5.5A.75.75 0 016.05 6zm3.9 0a.75.75 0 01.712.787l-.275 5.5a.75.75 0 01-1.498-.075l.275-5.5a.75.75 0 01.786-.711z" clipRule="evenodd" />
              </svg>
              Delete
            </button>
          )}
        </div>
        {current.uploaderName && (
          <p className="text-sm font-medium text-white/80">{current.uploaderName}</p>
        )}
        {fmtDate(current.createdAt) && (
          <p className="text-xs text-white/50">{fmtDate(current.createdAt)}</p>
        )}
        {(current.projectName || current.taskTitle) && (
          <p className="text-xs text-white/35 truncate">
            {[current.projectName, current.taskTitle].filter(Boolean).join(' · ')}
          </p>
        )}

        {photos.length > 1 && (
          <div className="flex justify-center gap-1.5 pt-2">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={() => { setIndex(i); setScale(1); setDrag(0) }}
                className={`rounded-full transition-all duration-200 ${
                  i === index ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/30'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )

  if (typeof document === 'undefined') return viewer
  return createPortal(viewer, document.body)
}
