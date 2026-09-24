import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/session'
import { LogoutForm } from '@/components/LogoutForm'
import { LocaleProvider } from '@/lib/i18n/LocaleContext'
import { t } from '@/lib/i18n/translate'
import { ThemeToggle } from '@/components/ThemeToggle'
import { SupabaseAuthBridge } from '@/components/SupabaseAuthBridge'

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  const user = getCurrentUser()

  if (!user) redirect('/login')
  if (user.status === 'pending') redirect('/pending')
  if (user.role !== 'owner') {
    if (user.role === 'admin') redirect('/admin/dashboard')
    if (user.role === 'client') redirect('/client')
    redirect('/home')
  }

  return (
    <LocaleProvider locale={user.language}>
    <SupabaseAuthBridge />
    <div className="min-h-screen bg-background">
      <header
        className="fixed top-0 left-0 right-0 z-40 bg-surface border-b border-[var(--border)]"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {/* Notch padding goes above the 56px row, not inside it (see /profile). */}
        <div className="flex items-center justify-between px-4 md:px-8 h-14">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="OrbitOps" className="w-7 h-7 rounded-lg object-cover" />
          <div>
            <p className="text-sm font-semibold text-primary leading-tight">OrbitOps</p>
            <p className="text-[10px] text-tertiary leading-tight">{t(user.language, 'owner.platformOwner')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/profile" className="text-xs text-secondary hidden sm:inline hover:text-primary transition-colors">{user.full_name}</Link>
          <ThemeToggle />
          <LogoutForm>
            <button
              type="submit"
              className="p-2 rounded-button text-secondary hover:text-danger hover:bg-danger/10 transition-colors"
              title="Sign out"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
              </svg>
            </button>
          </LogoutForm>
        </div>
        </div>
      </header>
      <main style={{ paddingTop: 'calc(3.5rem + env(safe-area-inset-top, 0px))' }}>{children}</main>
    </div>
    </LocaleProvider>
  )
}
