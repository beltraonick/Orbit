const CACHE = 'orbit-v4'
const OFFLINE_ASSETS = ['/', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(OFFLINE_ASSETS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return

  const url = new URL(e.request.url)
  // Only cache same-origin requests (app shell, pages, JS/CSS) — never
  // Supabase/API calls, those need to stay live or go through the
  // offline write queue instead.
  if (url.origin !== self.location.origin) return

  e.respondWith(
    (async () => {
      try {
        const res = await fetch(e.request)
        if (res && res.status === 200) {
          const cache = await caches.open(CACHE)
          await cache.put(e.request, res.clone())
        }
        return res
      } catch {
        const cached = await caches.match(e.request)
        return cached || (await caches.match('/'))
      }
    })()
  )
})

// Background sync: process queued photo uploads when connectivity returns
self.addEventListener('sync', e => {
  if (e.tag === 'photo-upload-queue') {
    e.waitUntil(processPhotoQueue())
  }
})

async function processPhotoQueue() {
  // Notify all clients to run the sync — the actual upload logic
  // lives in the app since it needs Supabase credentials from the session.
  const clients = await self.clients.matchAll({ type: 'window' })
  for (const client of clients) {
    client.postMessage({ type: 'PROCESS_PHOTO_QUEUE' })
  }
}

// Also trigger queue processing when the service worker receives a SYNC message
self.addEventListener('message', e => {
  if (e.data?.type === 'TRIGGER_SYNC') {
    processPhotoQueue()
  }
})

// ── Push notifications (lib/push.ts sends { title, body, url }) ──────────
self.addEventListener('push', e => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { body: e.data && e.data.text() } }
  const title = data.title || 'OrbitOps'
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if ('focus' in w) {
        await w.focus()
        if ('navigate' in w) return w.navigate(url)
        return
      }
    }
    return self.clients.openWindow(url)
  })())
})
