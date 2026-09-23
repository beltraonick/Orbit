'use client'

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

// useState that survives leaving the page: the last value is kept in this
// browser (localStorage) under `key` and restored when the screen opens
// again. Restore happens after mount so server and client render the same
// first frame. Storage failures (private mode, full) silently fall back to
// normal in-memory state.
export function usePersistentState<T>(
  key: string,
  initial: T,
  isValid: (v: unknown) => v is T = (v): v is T => v !== undefined && v !== null,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial)
  const restored = useRef(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('orbit.ui.' + key)
      if (raw != null) {
        const parsed = JSON.parse(raw)
        if (isValid(parsed)) setValue(parsed)
      }
    } catch { /* ignore */ }
    restored.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!restored.current) return
    try { localStorage.setItem('orbit.ui.' + key, JSON.stringify(value)) } catch { /* ignore */ }
  }, [key, value])

  return [value, setValue]
}

/** Validator for string unions: usePersistentState('k', 'a', oneOf(['a', 'b'])) */
export function oneOf<T extends string>(options: readonly T[]) {
  return (v: unknown): v is T => typeof v === 'string' && (options as readonly string[]).includes(v)
}
