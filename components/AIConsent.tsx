'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '@/lib/i18n/LocaleContext'

// Orbit AI sends company data to Groq, a third-party AI provider. App Store
// rules require telling the user and getting their OK before that happens,
// so every send goes through ensureConsent() first. The answer is kept per
// device (localStorage); if storage is unavailable we simply ask again.
const CONSENT_KEY = 'orbit_ai_consent_v1'

function hasStoredConsent(): boolean {
  try { return localStorage.getItem(CONSENT_KEY) === 'yes' } catch { return false }
}

export function useAIConsent() {
  const [asking, setAsking] = useState(false)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const ensureConsent = useCallback((): Promise<boolean> => {
    if (hasStoredConsent()) return Promise.resolve(true)
    setAsking(true)
    return new Promise(resolve => { resolver.current = resolve })
  }, [])

  const answer = useCallback((ok: boolean) => {
    if (ok) { try { localStorage.setItem(CONSENT_KEY, 'yes') } catch { /* ask again next time */ } }
    setAsking(false)
    resolver.current?.(ok)
    resolver.current = null
  }, [])

  const dialog = asking ? <AIConsentDialog onAnswer={answer} /> : null
  return { ensureConsent, dialog }
}

function AIConsentDialog({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const { t } = useTranslation()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[110] bg-black/60 flex items-end sm:items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-surface rounded-card border border-[var(--border)] p-5 shadow-xl">
        <h2 className="text-base font-semibold text-primary">{t('admin.aiChat.consentTitle')}</h2>
        <p className="text-sm text-secondary mt-2 leading-relaxed">{t('admin.aiChat.consentBody')}</p>
        <div className="flex flex-col gap-2 mt-5">
          <button
            type="button"
            onClick={() => onAnswer(true)}
            className="w-full rounded-button bg-brand text-white text-sm font-semibold py-2.5"
          >
            {t('admin.aiChat.consentAgree')}
          </button>
          <button
            type="button"
            onClick={() => onAnswer(false)}
            className="w-full rounded-button text-sm text-secondary py-2.5"
          >
            {t('admin.aiChat.consentDecline')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
