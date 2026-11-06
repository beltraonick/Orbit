'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signupCompany } from '@/app/actions/company-signup'
import { Input } from '@/components/ui/Input'
import { useIsNativeApp } from '@/lib/use-native-app'
import type { Language } from '@/lib/auth/types'

const PLANS: { key: 'free' | 'starter' | 'growth'; name: string; price: string; blurb: string; popular: boolean }[] = [
  { key: 'free', name: 'Free', price: '$0/mo', blurb: 'Up to 4 projects, 3 employees', popular: false },
  { key: 'starter', name: 'Starter', price: '$49/mo', blurb: 'Unlimited projects, most popular', popular: true },
  { key: 'growth', name: 'Growth', price: '$99/mo', blurb: 'More admins & employees, priority support', popular: false },
]

export function SignupForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<'free' | 'starter' | 'growth'>('starter')
  const native = useIsNativeApp()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const fd = new FormData(e.currentTarget)

    try {
      const result = await signupCompany({
        company_name: fd.get('company_name') as string,
        full_name: fd.get('full_name') as string,
        email: fd.get('email') as string,
        password: fd.get('password') as string,
        confirm_password: fd.get('confirm_password') as string,
        plan_key: plan,
        language: (fd.get('language') as Language) || 'en',
      })

      if (result.error) {
        setError(result.error)
        setLoading(false)
        return
      }

      router.push('/admin/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Input label="Company Name" name="company_name" type="text" placeholder="Acme Construction" required />
      <Input label="Your Full Name" name="full_name" type="text" placeholder="Jane Smith" required autoComplete="name" />
      <Input label="Email" name="email" type="email" placeholder="you@company.com" required autoComplete="email" />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-secondary">Preferred Language</label>
        <select
          name="language"
          defaultValue="en"
          className="h-11 w-full rounded-input bg-surface-elevated border border-[var(--border)] px-4 text-sm text-primary transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60 hover:border-[var(--border-strong)]"
        >
          <option value="en" className="bg-surface-elevated">English</option>
          <option value="pt" className="bg-surface-elevated">Português</option>
          <option value="es" className="bg-surface-elevated">Español</option>
        </select>
      </div>

      <Input label="Password" name="password" type="password" placeholder="Min. 8 characters" required autoComplete="new-password" />
      <Input label="Confirm Password" name="confirm_password" type="password" placeholder="••••••••" required autoComplete="new-password" />

      {/* Not in the iOS app: no plan prices or plan purchase there (see lib/use-native-app.ts). */}
      {native === false && <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-secondary">Plan</label>
        <div className="grid grid-cols-1 gap-2">
          {PLANS.map(p => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPlan(p.key)}
              className={[
                'flex items-center justify-between gap-3 rounded-input border px-4 py-3 text-left transition-colors duration-150',
                plan === p.key
                  ? 'bg-brand/10 border-brand/50'
                  : 'bg-surface-elevated border-[var(--border)] hover:border-[var(--border-strong)]',
              ].join(' ')}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-primary">{p.name}</span>
                  {p.popular && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-brand bg-brand/15 px-1.5 py-0.5 rounded-full">
                      Most Popular
                    </span>
                  )}
                </div>
                <p className="text-xs text-secondary mt-0.5">{p.blurb}</p>
              </div>
              <span className="text-sm font-semibold text-primary flex-shrink-0">{p.price}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-tertiary">You can change plans anytime from Settings.</p>
      </div>}

      {error && (
        <div className="bg-danger/10 border border-danger/20 rounded-input px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center justify-center gap-2 font-medium rounded-button transition-all duration-150 bg-brand hover:bg-brand-hover text-white h-12 px-6 text-base w-full mt-1 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
            </svg>
            Creating your workspace…
          </>
        ) : (
          'Start Free Trial'
        )}
      </button>
    </form>
  )
}
