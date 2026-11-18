'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { login } from '@/app/actions/auth'
import { Input } from '@/components/ui/Input'
import { t, translateError, type Locale } from '@/lib/i18n/login'
import { saveRememberToken, roleRedirectPath } from '@/lib/auth/remember'
import { useIsNativeApp } from '@/lib/use-native-app'

type RoleOption = 'admin' | 'employee' | 'client' | 'owner'

const DEMO_EMAILS: Record<RoleOption, string> = {
  admin: 'admin@orbit.test',
  employee: 'employee@orbit.test',
  client: 'client@orbit.test',
  owner: 'you@company.com',
}

export function LoginForm({ locale, showOwnerRole = false }: { locale: Locale; showOwnerRole?: boolean }) {
  const router = useRouter()
  const [selectedRole, setSelectedRole] = useState<RoleOption>('admin')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // iOS app: companies are created on the website only (App Store 3.1.1),
  // so the admin "Create account" link is hidden there. Employees can still
  // join their company with an invite code.
  const native = useIsNativeApp()

  const ROLES: { id: RoleOption; label: string; sub: string; icon: React.ReactNode }[] = [
    {
      id: 'admin',
      label: t(locale, 'roleAdmin'),
      sub: t(locale, 'roleAdminSub'),
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
        </svg>
      ),
    },
    {
      id: 'employee',
      label: t(locale, 'roleEmployee'),
      sub: t(locale, 'roleEmployeeSub'),
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      id: 'client',
      label: t(locale, 'roleClient'),
      sub: t(locale, 'roleClientSub'),
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
        </svg>
      ),
    },
    ...(showOwnerRole
      ? [
          {
            id: 'owner' as RoleOption,
            label: t(locale, 'roleOwner'),
            sub: t(locale, 'roleOwnerSub'),
            icon: (
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M10 1a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 5.106v9.593l2.293 2.293a1 1 0 010 1.414L11.586 20H8.414l-1.707-1.707a1 1 0 010-1.414L9 14.699V5.106L6.237 6.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.616a1 1 0 01.894-1.79l1.599.8L9 3.323V2a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            ),
          },
        ]
      : []),
  ]

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const fd = new FormData(e.currentTarget)
    const email = fd.get('email') as string
    const password = fd.get('password') as string

    try {
      const result = await login(email, password, locale)

      if (result.error) {
        setError(translateError(locale, result.error))
        setLoading(false)
        return
      }

      if (result.token) saveRememberToken(result.token)
      router.push(roleRedirectPath(result.role, result.status))
    } catch {
      setError(t(locale, 'errorGeneric'))
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Role selector */}
      <div>
        <p className="text-xs font-medium text-secondary mb-2 uppercase tracking-wide">{t(locale, 'iAmA')}</p>
        <div className={showOwnerRole ? 'grid grid-cols-4 gap-1.5' : 'grid grid-cols-3 gap-2'}>
          {ROLES.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedRole(r.id)}
              className={[
                'flex flex-col items-center gap-1.5 px-2 py-3 rounded-button border transition-all duration-150 text-center',
                selectedRole === r.id
                  ? 'bg-brand/10 border-brand/50 text-brand'
                  : 'bg-surface-elevated border-[var(--border)] text-tertiary hover:text-secondary hover:border-[var(--border-strong)]',
              ].join(' ')}
            >
              {r.icon}
              <span className="text-[11px] font-semibold leading-tight">{r.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Login form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          label={t(locale, 'emailLabel')}
          name="email"
          type="email"
          placeholder={DEMO_EMAILS[selectedRole]}
          required
          autoComplete="email"
        />
        <div className="space-y-1">
          <Input
            label={t(locale, 'passwordLabel')}
            name="password"
            type="password"
            placeholder="••••••••"
            required
            autoComplete="current-password"
          />
          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-xs text-secondary hover:text-brand transition-colors"
            >
              {t(locale, 'forgotPassword')}
            </Link>
          </div>
        </div>

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
              {t(locale, 'signingIn')}
            </>
          ) : (
            t(locale, 'signIn')
          )}
        </button>
      </form>

      {/* Dynamic create-account link based on selected role */}
      {selectedRole !== 'owner' && !(selectedRole === 'admin' && native !== false) && (
        <p className="text-center text-sm text-secondary pt-1">
          {t(locale, 'noAccount')}{' '}
          <Link
            href={selectedRole === 'admin' ? '/signup' : '/register'}
            className="text-brand hover:text-brand-hover font-medium transition-colors"
          >
            {t(locale, 'createAccountLink')}
          </Link>
        </p>
      )}

      {/* Dev hint */}
      {process.env.NODE_ENV === 'development' && (
        <div className="bg-amber/5 border border-amber/20 rounded-card p-3">
          <p className="text-[11px] font-semibold text-amber mb-1.5">Test accounts (password: Admin123! / Employee123! / Client123!)</p>
          <div className="space-y-0.5">
            <p className="text-[11px] text-secondary font-mono">admin@orbit.test · Admin123!</p>
            <p className="text-[11px] text-secondary font-mono">employee@orbit.test · Employee123!</p>
            <p className="text-[11px] text-secondary font-mono">client@orbit.test · Client123!</p>
          </div>
        </div>
      )}
    </div>
  )
}
