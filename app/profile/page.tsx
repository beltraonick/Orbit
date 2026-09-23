import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/session'
import { getMyProfile } from '@/app/actions/profile'
import { LogoutForm } from '@/components/LogoutForm'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { t } from '@/lib/i18n/translate'
import { ProfileForm } from './ProfileForm'

const BACK_BY_ROLE: Record<string, string> = {
  admin: '/admin/dashboard',
  employee: '/home',
  client: '/client',
  owner: '/owner/dashboard',
}

export default async function ProfilePage() {
  const user = getCurrentUser()
  if (!user) redirect('/login')

  const profile = await getMyProfile()
  const backHref = BACK_BY_ROLE[user.role] ?? '/login'
  const locale = profile?.language ?? user.language

  return (
    <LocaleProvider locale={locale}>
      <div className="min-h-screen bg-background">
        <header
          className="fixed top-0 left-0 right-0 z-40 bg-surface border-b border-[var(--border)] flex items-center justify-between px-4 h-14"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
          <a href={backHref} className="flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            {t(locale, 'profile.back')}
          </a>
          <p className="text-sm font-semibold text-primary">{t(locale, 'profile.header')}</p>
          <LogoutForm>
            <button type="submit" className="text-xs text-secondary hover:text-danger transition-colors">{t(locale, 'profile.signOut')}</button>
          </LogoutForm>
        </header>

        <main className="max-w-lg mx-auto px-4 py-6 md:py-8" style={{ paddingTop: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}>
          <ProfileForm
            initialProfile={{
              id: user.id,
              full_name: profile?.full_name ?? user.full_name,
              email: profile?.email ?? user.email,
              phone: profile?.phone ?? null,
              avatar_url: profile?.avatar_url ?? null,
              language: profile?.language ?? user.language,
              email_notifications: profile?.email_notifications ?? true,
              role: user.role,
            }}
          />
        </main>
      </div>
    </LocaleProvider>
  )
}
