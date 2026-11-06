'use client'

import { useEffect, useState } from 'react'

// True inside the iOS app (the Capacitor wrapper injects window.Capacitor
// into the WebView), false in a normal browser, null until known.
//
// Used to keep plan prices and plan purchase off the App Store build: Apple
// doesn't allow selling a subscription inside an iOS app except through its
// own in-app purchase, so plans are only shown/changed on the website.
export function useIsNativeApp(): boolean | null {
  const [native, setNative] = useState<boolean | null>(null)
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor
    setNative(!!cap && (cap.isNativePlatform?.() === true || (cap.getPlatform?.() ?? 'web') !== 'web'))
  }, [])
  return native
}
