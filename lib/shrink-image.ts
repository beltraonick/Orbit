'use client'

// Phone cameras save 3–5 MB photos; on screen nobody can tell them apart
// from a ~1600px JPEG of a few hundred KB. Every photo upload goes through
// this first (the employee task screen already did the same, see
// app/(employee)/tasks/TaskList.tsx), so storage grows ~10× slower.
//
// Only photos are touched: videos, PDFs, GIFs and anything the browser
// can't read come back unchanged, and so does a photo that is already
// small enough. Photos already in storage are never modified.

const SKIP_TYPES = new Set(['image/gif', 'image/svg+xml'])

export async function shrinkImageFile(file: File, maxPx = 1600, quality = 0.85): Promise<File> {
  if (!file.type.startsWith('image/') || SKIP_TYPES.has(file.type)) return file
  if (file.size < 300 * 1024) return file

  try {
    const url = URL.createObjectURL(file)
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = reject
      el.src = url
    })
    const scale = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) { URL.revokeObjectURL(url); return file }
    // White under transparent PNG areas instead of black in the JPEG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified })
  } catch {
    return file
  }
}
