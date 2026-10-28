'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { RegisterForm } from './RegisterForm'
import { LanguageSwitcher } from '../login/LanguageSwitcher'
import { getStoredLocale, storeLocale, t, type Locale } from '@/lib/i18n/login'

export function RegisterScreen() {
  const [locale, setLocale] = useState<Locale>('en')
  const [initialCode, setInitialCode] = useState('')

  useEffect(() => {
    setLocale(getStoredLocale())
    const p = new URLSearchParams(window.location.search)
    const code = p.get('code')
    if (code) setInitialCode(code.toUpperCase())
  }, [])

  function handleChange(l: Locale) {
    setLocale(l)
    storeLocale(l)
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <LanguageSwitcher locale={locale} onChange={handleChange} />

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="OrbitOps" className="w-14 h-14 rounded-2xl mb-4 shadow-lg object-cover" />
          <h1 className="text-2xl font-bold text-primary tracking-tight">{t(locale, 'registerTitle')}</h1>
          <p className="text-sm text-secondary mt-1 text-center">{t(locale, 'registerSubtitle')}</p>
        </div>

        {/* Company redirect callout */}
        <div className="mb-4 flex items-center justify-between gap-3 rounded-input border border-[var(--border)] bg-surface px-4 py-3">
          <p className="text-xs text-secondary">{t(locale, 'registerCompanyHint')}</p>
          <Link
            href="/signup"
            className="text-xs font-semibold text-brand hover:text-brand-hover transition-colors flex-shrink-0"
          >
            {t(locale, 'registerCompanyLink')}
          </Link>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-card border border-[var(--border)] p-6">
          <RegisterForm locale={locale} initialCode={initialCode} />
        </div>

        <p className="text-center text-sm text-secondary mt-6">
          {t(locale, 'alreadyHaveAccount')}{' '}
          <Link href="/login" className="text-brand hover:text-brand-hover font-medium transition-colors">
            {t(locale, 'signIn')}
          </Link>
        </p>
      </div>
    </div>
  )
}
