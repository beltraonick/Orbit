'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  onCapture: (base64: string, mediaType: string) => void
  onClose: () => void
}

export function ReceiptScanner({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const [cameraError, setCameraError] = useState(false)
  const [captured, setCaptured] = useState<{ base64: string; mediaType: string; dataUrl: string } | null>(null)

  useEffect(() => {
    let active = true
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } } })
      .then(stream => {
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().then(() => { if (active) setReady(true) })
        }
      })
      .catch(() => { if (active) setCameraError(true) })

    return () => {
      active = false
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  function handleClose() {
    stopCamera()
    onClose()
  }

  function captureFromCamera() {
    const video = videoRef.current
    if (!video || !ready) return
    const MAX = 1600
    const scale = Math.min(1, MAX / Math.max(video.videoWidth || 1, video.videoHeight || 1))
    const w = Math.round(video.videoWidth * scale)
    const h = Math.round(video.videoHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(video, 0, 0, w, h)
    stopCamera()
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    const base64 = dataUrl.split(',')[1]
    setCaptured({ base64, mediaType: 'image/jpeg', dataUrl })
  }

  function compressFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const MAX_PX = 1600
        const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        stopCamera()
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
        const base64 = dataUrl.split(',')[1]
        setCaptured({ base64, mediaType: 'image/jpeg', dataUrl })
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) compressFile(file)
  }

  function handleRetake() {
    setCaptured(null)
    // Restart camera
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } } })
      .then(stream => {
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().then(() => setReady(true))
        }
      })
      .catch(() => setCameraError(true))
  }

  function handleConfirm() {
    if (!captured) return
    onCapture(captured.base64, captured.mediaType)
  }

  /* ── Review screen ── */
  if (captured) {
    return (
      <div className="fixed inset-0 z-[60] bg-black flex flex-col select-none" style={{ touchAction: 'none' }}>
        {/* Header */}
        <div className="relative flex items-center justify-center px-5 pb-2" style={{ paddingTop: 'max(48px, env(safe-area-inset-top, 0px) + 16px)' }}>
          <button
            onClick={handleClose}
            className="absolute left-5 text-white/70 text-sm font-medium active:opacity-50 transition-opacity"
          >
            Cancel
          </button>
          <span className="text-white text-sm font-semibold tracking-wide">Review Photo</span>
        </div>

        {/* Image preview */}
        <div className="flex-1 relative overflow-hidden flex items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={captured.dataUrl}
            alt="Captured receipt"
            className="max-w-full max-h-full object-contain rounded-xl"
            style={{ boxShadow: '0 4px 30px rgba(0,0,0,0.5)' }}
          />
        </div>

        <p className="text-white/50 text-xs text-center py-2 px-8">Make sure the receipt is clear and readable</p>

        {/* Bottom controls */}
        <div
          className="flex items-center gap-4 px-6"
          style={{ paddingBottom: 'max(40px, env(safe-area-inset-bottom, 0px) + 28px)' }}
        >
          <button
            onClick={handleRetake}
            className="flex-1 py-3.5 rounded-2xl text-sm font-semibold text-white transition-opacity active:opacity-70"
            style={{ background: 'rgba(255,255,255,0.15)', border: '1.5px solid rgba(255,255,255,0.25)' }}
          >
            Retake
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 py-3.5 rounded-2xl text-sm font-semibold text-white transition-opacity active:opacity-70"
            style={{ background: '#3b82f6' }}
          >
            Use Photo
          </button>
        </div>
      </div>
    )
  }

  /* ── Camera unavailable: show file picker ── */
  if (cameraError) {
    return (
      <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 w-full max-w-xs text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 mx-auto rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500" viewBox="0 0 24 24">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          <div>
            <p className="font-semibold text-sm text-gray-900 dark:text-white">Camera unavailable</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Choose a photo from your library instead.</p>
          </div>
          <label className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-blue-500 text-white text-sm font-semibold cursor-pointer hover:bg-blue-600 transition-colors active:scale-[.98]">
            <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleFile} />
            Choose Photo
          </label>
          <button onClick={handleClose} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">Cancel</button>
        </div>
      </div>
    )
  }

  /* ── Camera scanner UI ── */
  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col select-none" style={{ touchAction: 'none' }}>

      {/* Header */}
      <div className="relative flex items-center justify-center px-5 pb-2" style={{ paddingTop: 'max(48px, env(safe-area-inset-top, 0px) + 16px)' }}>
        <button
          onClick={handleClose}
          className="absolute left-5 text-white/80 text-sm font-medium active:opacity-50 transition-opacity"
        >
          Cancel
        </button>
        <span className="text-white text-sm font-semibold tracking-wide">Scan Receipt</span>
      </div>

      {/* Camera view */}
      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
        />

        {/* Starting state */}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-white/50 text-sm">Starting camera…</p>
          </div>
        )}

        {/* Scanner overlay */}
        {ready && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ paddingBottom: '8%' }}>
            {/* The scan frame — box-shadow creates the dark vignette outside */}
            <div
              className="relative rounded-2xl"
              style={{
                width: 'min(76vw, 290px)',
                aspectRatio: '3/4',
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
              }}
            >
              {/* Corner brackets */}
              <span className="absolute top-0 left-0 w-8 h-8" style={{ borderTop: '3px solid #fff', borderLeft: '3px solid #fff', borderRadius: '10px 0 0 0' }} />
              <span className="absolute top-0 right-0 w-8 h-8" style={{ borderTop: '3px solid #fff', borderRight: '3px solid #fff', borderRadius: '0 10px 0 0' }} />
              <span className="absolute bottom-0 left-0 w-8 h-8" style={{ borderBottom: '3px solid #fff', borderLeft: '3px solid #fff', borderRadius: '0 0 0 10px' }} />
              <span className="absolute bottom-0 right-0 w-8 h-8" style={{ borderBottom: '3px solid #fff', borderRight: '3px solid #fff', borderRadius: '0 0 10px 0' }} />

              {/* Animated scan line */}
              <div
                className="receipt-scan-line absolute inset-x-3 h-0.5 rounded-full"
                style={{
                  background: 'linear-gradient(90deg, transparent 0%, #4ade80 30%, #4ade80 70%, transparent 100%)',
                  boxShadow: '0 0 10px 3px rgba(74,222,128,0.45)',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Hint */}
      <p className="text-white/50 text-xs text-center py-2 px-8">Align the receipt inside the frame</p>

      {/* Bottom controls */}
      <div
        className="flex flex-col items-center gap-5"
        style={{ paddingBottom: 'max(40px, env(safe-area-inset-bottom, 0px) + 28px)' }}
      >
        {/* Shutter button */}
        <button
          onClick={captureFromCamera}
          disabled={!ready}
          className="rounded-full border-[5px] border-white/30 disabled:opacity-25 active:scale-90 transition-transform"
          style={{ width: 74, height: 74, background: 'rgba(255,255,255,0.92)' }}
          aria-label="Capture"
        />

        {/* File fallback */}
        <label className="text-white/45 text-xs cursor-pointer active:opacity-60 underline underline-offset-2">
          <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={handleFile} />
          Use photo from library instead
        </label>
      </div>

      <style>{`
        @keyframes receipt-scanline {
          0%   { top: 5% }
          50%  { top: 88% }
          100% { top: 5% }
        }
        .receipt-scan-line {
          position: absolute;
          animation: receipt-scanline 2.4s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
