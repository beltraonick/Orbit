'use client'

import { useState } from 'react'
import { PhotoThumb } from '../../PhotoThumb'
import { Badge } from '@/components/ui/Badge'
import { PhotoLightbox } from '@/components/ui/PhotoLightbox'

interface Photo {
  id: string
  url: string
  tag: string
  caption: string | null
  createdAt: string
}

function photoTagVariant(tag: string): 'green' | 'blue' | 'gray' {
  if (tag === 'before') return 'gray'
  if (tag === 'after') return 'green'
  return 'blue'
}

// A plain <a target="_blank"> here opens the full photo in a new browser
// tab with no way back inside an installed PWA — the same bug reported and
// fixed for expense receipts. Uses the shared in-app lightbox instead.
export function PhotoGrid({ photos }: { photos: Photo[] }) {
  const [viewingIndex, setViewingIndex] = useState<number | null>(null)

  return (
    <>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 px-5 pb-5">
        {photos.map((photo, i) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setViewingIndex(i)}
            className="group relative aspect-square rounded-input overflow-hidden bg-surface-elevated border border-[var(--border)]"
          >
            <PhotoThumb src={photo.url} alt={photo.caption ?? photo.tag} className="w-full h-full object-cover group-hover:opacity-90 transition-opacity" />
            <span className="absolute bottom-1 left-1">
              <Badge variant={photoTagVariant(photo.tag)} className="text-[9px] px-1.5 py-0">{photo.tag}</Badge>
            </span>
          </button>
        ))}
      </div>

      {viewingIndex !== null && (
        <PhotoLightbox
          photos={photos.map(p => ({ url: p.url, category: p.tag, createdAt: p.createdAt }))}
          initialIndex={viewingIndex}
          onClose={() => setViewingIndex(null)}
        />
      )}
    </>
  )
}
