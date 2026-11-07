import sharp from 'sharp'
import { getCurrentUser } from '@/lib/auth/session'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

// Owner panel → "Shrink existing photos". Makes photos already in storage
// smaller (1600px JPEG), the same size new uploads get (lib/shrink-image.ts).
// Every photo is KEPT at the same path, so nothing in the app changes and
// nothing is deleted — only the file gets lighter.
//
// GET  → list of photos worth shrinking (images over 500 KB).
// POST → { files: [{ bucket, path }] } shrinks up to 5 of them per call; the
//        owner panel calls it repeatedly and shows the progress.
//
// Skipped on purpose: plans (PDF blueprints), videos, HEIC (can't be read
// here), anything small, and any file that wouldn't get at least 30% smaller.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKETS = ['project-photos', 'task-photos', 'receipts']
const MIN_BYTES = 500 * 1024
const SHRINKABLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const MAX_PER_CALL = 5

interface Candidate { bucket: string; path: string; size: number }

function isOwner(): boolean {
  return getCurrentUser()?.role === 'owner'
}

type Storage = ReturnType<typeof createServiceRoleClient>['storage']

async function walk(storage: Storage, bucket: string, prefix: string, out: Candidate[], depth = 0): Promise<void> {
  if (depth > 6) return
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error || !data || data.length === 0) return
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name
      const meta = item.metadata as { size?: number; mimetype?: string } | null
      if (!item.id || !meta) {
        await walk(storage, bucket, path, out, depth + 1) // a folder
      } else if ((meta.size ?? 0) >= MIN_BYTES && SHRINKABLE.has((meta.mimetype ?? '').toLowerCase())) {
        out.push({ bucket, path, size: meta.size ?? 0 })
      }
    }
    if (data.length < 1000) return
  }
}

export async function GET() {
  if (!isOwner()) return new Response('Unauthorized', { status: 401 })
  const storage = createServiceRoleClient().storage
  const files: Candidate[] = []
  for (const bucket of BUCKETS) await walk(storage, bucket, '', files)
  return Response.json({ files, totalBytes: files.reduce((s, f) => s + f.size, 0) })
}

export async function POST(req: Request) {
  if (!isOwner()) return new Response('Unauthorized', { status: 401 })
  const body = (await req.json().catch(() => null)) as { files?: Array<{ bucket: string; path: string }> } | null
  const files = (body?.files ?? []).filter(f => BUCKETS.includes(f.bucket) && typeof f.path === 'string').slice(0, MAX_PER_CALL)
  const storage = createServiceRoleClient().storage

  const results = []
  for (const f of files) {
    try {
      const { data: blob, error } = await storage.from(f.bucket).download(f.path)
      if (error || !blob) { results.push({ ...f, status: 'error' as const }); continue }
      const original = Buffer.from(await blob.arrayBuffer())
      const smaller = await sharp(original, { failOn: 'none' })
        .rotate() // keep the photo upright (EXIF orientation)
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer()

      if (smaller.length > original.length * 0.7) {
        results.push({ ...f, status: 'skipped' as const, before: original.length, after: original.length })
        continue
      }
      const { error: upErr } = await storage.from(f.bucket).upload(f.path, smaller, {
        upsert: true,
        contentType: 'image/jpeg',
        cacheControl: '3600',
      })
      if (upErr) { results.push({ ...f, status: 'error' as const }); continue }
      results.push({ ...f, status: 'shrunk' as const, before: original.length, after: smaller.length })
    } catch {
      results.push({ ...f, status: 'error' as const })
    }
  }
  return Response.json({ results })
}
