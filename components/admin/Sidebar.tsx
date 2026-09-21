'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Avatar } from '@/components/ui/Avatar'
import { LogoutForm } from '@/components/LogoutForm'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { ThemeToggle } from '@/components/ThemeToggle'
import type { SessionUser } from '@/lib/auth/types'

function useNav() {
  const { t } = useTranslation()
  return [
  {
    label: t('common.nav.dashboard'),
    mobileLabel: t('common.nav.dashboardMobile'),
    href: '/admin/dashboard',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
      </svg>
    ),
  },
  {
    label: 'OrbitOps AI',
    mobileLabel: 'AI',
    href: '/admin/ai',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
    ),
  },
  {
    label: t('common.nav.employees'),
    mobileLabel: t('common.nav.employeesMobile'),
    href: '/admin/employees',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
      </svg>
    ),
  },
  {
    label: t('common.nav.projects'),
    mobileLabel: t('common.nav.projects'),
    href: '/admin/projects',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    label: t('common.nav.tasks'),
    mobileLabel: t('common.nav.tasks'),
    href: '/admin/tasks',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
        <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    label: t('common.nav.members'),
    mobileLabel: t('common.nav.members'),
    href: '/admin/members',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
      </svg>
    ),
  },
  {
    label: t('common.nav.changeOrders'),
    mobileLabel: t('common.nav.changeOrdersMobile'),
    href: '/admin/change-orders',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm7 4a1 1 0 10-2 0v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V8z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    label: t('common.nav.time'),
    mobileLabel: t('common.nav.time'),
    href: '/admin/time',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    label: t('common.nav.payroll'),
    mobileLabel: t('common.nav.payrollMobile'),
    href: '/admin/payroll',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    label: t('common.nav.photos'),
    mobileLabel: t('common.nav.photos'),
    href: '/admin/photos',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    label: t('common.nav.reports'),
    mobileLabel: t('common.nav.reports'),
    href: '/admin/reports',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm2 10a1 1 0 10-2 0v3a1 1 0 102 0v-3zm2-3a1 1 0 011 1v5a1 1 0 11-2 0v-5a1 1 0 011-1zm4-1a1 1 0 10-2 0v6a1 1 0 102 0V8z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    label: t('common.nav.expenses'),
    mobileLabel: t('common.nav.expenses'),
    href: '/admin/expenses',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    label: t('common.nav.mileage'),
    mobileLabel: t('common.nav.mileage'),
    href: '/admin/mileage',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
        <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1v-1h3.05a2.5 2.5 0 014.9 0H19a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0017 6h-3V5a1 1 0 00-1-1H3zm11 4h2.586L18 9.414V10h-4V8z" />
      </svg>
    ),
  },
  {
    label: t('common.nav.vehicles'),
    mobileLabel: t('common.nav.vehicles'),
    href: '/admin/vehicles',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
        <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zm9 2h2.586L16 7.414V10h-4V6z" />
      </svg>
    ),
  },
  {
    label: t('common.nav.approvals'),
    mobileLabel: t('common.nav.approvals'),
    href: '/admin/approvals',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    label: t('common.nav.settings'),
    mobileLabel: t('common.nav.settingsMobile'),
    href: '/admin/settings',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px]">
        <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
      </svg>
    ),
  },
  ]
}

// The bottom nav only has room for 5 items — the rest moved to
// Quick Actions on the Dashboard/Home page.
const MOBILE_NAV_HREFS = ['/admin/dashboard', '/admin/tasks', '/admin/projects', '/admin/employees', '/admin/ai']

export function Sidebar({ user, pendingCount = 0, auditCount = 0 }: { user: SessionUser; pendingCount?: number; auditCount?: number }) {
  const pathname = usePathname()
  const { t } = useTranslation()
  const NAV = useNav()
  const MOBILE_NAV = MOBILE_NAV_HREFS.map(href => NAV.find(item => item.href === href)).filter(
    (item): item is ReturnType<typeof useNav>[number] => !!item
  )

  return (
    <>
      {/* ── Desktop Sidebar (md+) ── */}
      <aside className="hidden md:flex fixed left-0 top-0 h-screen w-[240px] flex-col bg-surface border-r border-[var(--border)] z-40">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-[var(--border)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="OrbitOps" className="w-8 h-8 rounded-lg flex-shrink-0 object-cover" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary truncate leading-tight">OrbitOps</p>
            <p className="text-[11px] text-tertiary truncate">{t('common.workforce')}</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {NAV.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            const isMembersItem = item.href === '/admin/members'
            const isTasksItem = item.href === '/admin/tasks'
            const isApprovalsItem = item.href === '/admin/approvals'
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'flex items-center gap-3 px-3 py-2.5 rounded-button text-sm font-medium transition-colors duration-150',
                  active
                    ? 'bg-brand text-white'
                    : 'text-secondary hover:text-primary hover:bg-surface-elevated',
                ].join(' ')}
              >
                <span className={active ? 'text-white' : 'text-tertiary'}>{item.icon}</span>
                {item.label}
                {isMembersItem && pendingCount > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center px-1 leading-none">
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </span>
                )}
                {isTasksItem && auditCount > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] rounded-full text-white text-[10px] font-bold flex items-center justify-center px-1 leading-none"
                    style={{ background: 'rgb(var(--color-amber))' }}>
                    {auditCount > 99 ? '99+' : auditCount}
                  </span>
                )}
                {isApprovalsItem && pendingCount > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] rounded-full bg-amber text-white text-[10px] font-bold flex items-center justify-center px-1 leading-none">
                    {pendingCount > 99 ? '99+' : pendingCount}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* User + Theme + Logout */}
        <div className="px-3 py-4 border-t border-[var(--border)] space-y-1">
          <Link href="/profile" className="flex items-center gap-3 px-3 py-2 rounded-button hover:bg-surface-elevated transition-colors">
            <Avatar name={user.full_name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-primary truncate leading-tight">{user.full_name}</p>
              <p className="text-[11px] text-tertiary truncate capitalize">{user.role}</p>
            </div>
          </Link>
          <ThemeToggle layout="sidebar" />
          <LogoutForm>
            <button
              type="submit"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-button text-sm font-medium text-secondary hover:text-danger hover:bg-danger/10 transition-colors duration-150"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-[18px] h-[18px] flex-shrink-0">
                <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
              </svg>
              {t('common.signOut')}
            </button>
          </LogoutForm>
        </div>
      </aside>

      {/* ── Mobile Top Bar (< md) ── */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-surface border-b border-[var(--border)]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center justify-between px-4 h-14">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="OrbitOps" className="w-7 h-7 rounded-lg object-cover" />
          <span className="text-sm font-semibold text-primary">OrbitOps</span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link href="/profile" aria-label="Profile & Settings">
            <Avatar name={user.full_name} size="sm" />
          </Link>
          <LogoutForm>
            <button
              type="submit"
              aria-label={t('common.signOut')}
              className="p-2 rounded-button text-secondary hover:text-danger hover:bg-danger/10 transition-colors"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clipRule="evenodd" />
              </svg>
            </button>
          </LogoutForm>
        </div>
        </div>
      </header>

      {/* ── Mobile Bottom Nav (< md) — 5 fixed tabs, the rest live as Quick Actions on Home ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-[var(--border)] safe-bottom">
        <div className="flex">
          {MOBILE_NAV.map(item => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            const isMembersItem = item.href === '/admin/members'
            const isTasksItem = item.href === '/admin/tasks'
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-medium transition-colors duration-150',
                  active ? 'text-brand' : 'text-tertiary',
                ].join(' ')}
              >
                <span className={`relative [&>svg]:w-5 [&>svg]:h-5 ${active ? 'text-brand' : 'text-tertiary'}`}>
                  {item.icon}
                  {isMembersItem && pendingCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-brand border border-surface" />
                  )}
                  {isTasksItem && auditCount > 0 && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-surface"
                      style={{ background: 'rgb(var(--color-amber))' }} />
                  )}
                </span>
                <span className="leading-tight text-center">{item.mobileLabel}</span>
                {active && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 rounded-full bg-brand" />
                )}
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
