'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { usePermissions } from '@/lib/permissions-context'
import { hasPermission } from '@/lib/permissions'

export function EmployeeNav() {
  const pathname = usePathname()
  const { t } = useTranslation()
  const permissions = usePermissions()
  const isSupervisor = hasPermission(permissions, 'checkin_team') ||
    hasPermission(permissions, 'create_extras') ||
    hasPermission(permissions, 'close_payroll')
  const canTrackMileage = hasPermission(permissions, 'track_mileage')
  const canUploadReceipts = hasPermission(permissions, 'upload_receipts')

  const NAV = [
    {
      href: '/home',
      label: t('common.nav.home'),
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
        </svg>
      ),
    },
    ...(isSupervisor
      ? [
          {
            href: '/projects',
            label: t('common.nav.projects'),
            icon: (
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-5L9 4H4zm7 5a1 1 0 10-2 0v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V9z" clipRule="evenodd" />
              </svg>
            ),
          },
        ]
      : []),
    {
      href: '/ponto',
      label: t('common.nav.hours'),
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
        </svg>
      ),
    },
    {
      href: '/pagamento',
      label: t('common.nav.pagamento'),
      icon: (
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
        </svg>
      ),
    },
    ...(canUploadReceipts
      ? [
          {
            href: '/expenses',
            label: t('common.nav.expenses'),
            icon: (
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
            ),
          },
        ]
      : []),
    ...(canTrackMileage
      ? [
          {
            href: '/mileage',
            label: t('common.nav.mileage'),
            icon: (
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1v-1h3.05a2.5 2.5 0 014.9 0H19a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0017 6h-3V5a1 1 0 00-1-1H3zm11 4h2.586L18 9.414V10h-4V8z" />
              </svg>
            ),
          },
        ]
      : []),
    ...(isSupervisor
      ? [
          {
            href: '/team',
            label: t('common.nav.team'),
            icon: (
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
              </svg>
            ),
          },
        ]
      : []),
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-[var(--border)] flex safe-bottom">
      {NAV.map(item => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[
              'flex-1 flex flex-col items-center justify-center gap-1 py-3 text-xs font-medium transition-colors duration-150',
              active ? 'text-brand' : 'text-tertiary hover:text-secondary',
            ].join(' ')}
          >
            <span className={active ? 'text-brand' : 'text-tertiary'}>{item.icon}</span>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
