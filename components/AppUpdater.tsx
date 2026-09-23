'use client'

import { useEffect } from 'react'

const CHECK_EVERY_MS = 5 * 60 * 1000

// iOS home-screen apps keep the old JavaScript in memory when resumed, so a
// fix can be live on the server while the phone still runs the old code.
// When the app comes back to the foreground (and every few minutes), this
// asks the server which build is deployed and reloads once if it changed.
export function AppUpdater() {
  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_BUILD_ID
    if (!mine || mine === 'dev') return

    async function check() {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const { build } = await res.json()
        if (!build || build === 'dev' || build === mine) return
        // Reload at most once per new build, so a stale CDN edge can't loop.
        const key = 'orbit.reloadedFor'
        if (sessionStorage.getItem(key) === build) return
        sessionStorage.setItem(key, build)
        window.location.reload()
      } catch { /* offline — try again later */ }
    }

    check()
    document.addEventListener('visibilitychange', check)
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      document.removeEventListener('visibilitychange', check)
      clearInterval(timer)
    }
  }, [])

  return null
}
