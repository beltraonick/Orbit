'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { EmployeePermissions } from './permissions'
import { getMyPermissions } from '@/app/actions/permissions'

const PermissionsContext = createContext<EmployeePermissions>({})

const REFRESH_INTERVAL_MS = 60_000

export function PermissionsProvider({
  permissions,
  children,
}: {
  permissions: EmployeePermissions
  children: React.ReactNode
}) {
  const [current, setCurrent] = useState(permissions)
  const initial = useRef(permissions)

  // Keep in sync if the server-rendered layout re-fetches with new values
  // (e.g. a full navigation into the group after having left it).
  useEffect(() => {
    if (initial.current !== permissions) {
      initial.current = permissions
      setCurrent(permissions)
    }
  }, [permissions])

  // A supervisor's permissions can be revoked by an admin while their app
  // stays open — refresh periodically and whenever the tab regains focus so
  // a revocation takes effect without requiring a full app restart.
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const next = await getMyPermissions()
        if (!cancelled) setCurrent(next)
      } catch {
        // silent — keep showing the last known permissions
      }
    }

    const interval = setInterval(refresh, REFRESH_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return <PermissionsContext.Provider value={current}>{children}</PermissionsContext.Provider>
}

// Reads the logged-in employee's permission toggles, kept fresh by
// PermissionsProvider (periodic refresh + refresh on focus).
export function usePermissions(): EmployeePermissions {
  return useContext(PermissionsContext)
}
