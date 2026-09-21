'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useTranslation } from '@/lib/i18n/LocaleContext'

type Action = {
  href: string
  labelKey: string
  iconBg: string
  iconColor: string
  icon: React.ReactNode
}

const ALL_ACTIONS: Action[] = [
  {
    href: '/admin/team-clock',
    labelKey: 'common.nav.teamClock',
    iconBg: 'bg-blue/10',
    iconColor: 'text-blue',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
      </svg>
    ),
  },
  {
    href: '/admin/payroll',
    labelKey: 'common.nav.payroll',
    iconBg: 'bg-green/10',
    iconColor: 'text-green',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/admin/members',
    labelKey: 'common.nav.members',
    iconBg: 'bg-brand/10',
    iconColor: 'text-brand',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
      </svg>
    ),
  },
  {
    href: '/admin/change-orders',
    labelKey: 'common.nav.changeOrders',
    iconBg: 'bg-amber/10',
    iconColor: 'text-amber',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm7 4a1 1 0 10-2 0v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V8z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/admin/projects',
    labelKey: 'common.nav.projects',
    iconBg: 'bg-blue/10',
    iconColor: 'text-blue',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/admin/employees',
    labelKey: 'common.nav.employees',
    iconBg: 'bg-brand/10',
    iconColor: 'text-brand',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
      </svg>
    ),
  },
  {
    href: '/admin/tasks',
    labelKey: 'common.nav.tasks',
    iconBg: 'bg-amber/10',
    iconColor: 'text-amber',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
        <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/admin/approvals',
    labelKey: 'common.nav.approvals',
    iconBg: 'bg-green/10',
    iconColor: 'text-green',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/admin/time',
    labelKey: 'common.nav.time',
    iconBg: 'bg-blue/10',
    iconColor: 'text-blue',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/admin/photos',
    labelKey: 'common.nav.photos',
    iconBg: 'bg-brand/10',
    iconColor: 'text-brand',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/admin/expenses',
    labelKey: 'common.nav.expenses',
    iconBg: 'bg-amber/10',
    iconColor: 'text-amber',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v4a2 2 0 002 2V6h10a2 2 0 00-2-2H4zm2 6a2 2 0 012-2h8a2 2 0 012 2v4a2 2 0 01-2 2H8a2 2 0 01-2-2v-4zm6 4a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/admin/receipts',
    labelKey: 'common.nav.receipts',
    iconBg: 'bg-green/10',
    iconColor: 'text-green',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-5L9 4H4zm7 5a1 1 0 10-2 0v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V9z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/admin/mileage',
    labelKey: 'common.nav.mileage',
    iconBg: 'bg-blue/10',
    iconColor: 'text-blue',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
        <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1v-1h3.05a2.5 2.5 0 014.9 0H19a1 1 0 001-1v-5a1 1 0 00-.293-.707l-2-2A1 1 0 0017 6h-3V5a1 1 0 00-1-1H3zm11 4h2.586L18 9.414V10h-4V8z" />
      </svg>
    ),
  },
  {
    href: '/admin/vehicles',
    labelKey: 'common.nav.vehicles',
    iconBg: 'bg-amber/10',
    iconColor: 'text-amber',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M8 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM15 16.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
        <path d="M3 4a1 1 0 00-1 1v10a1 1 0 001 1h1.05a2.5 2.5 0 014.9 0H10a1 1 0 001-1V5a1 1 0 00-1-1H3zm9 2h2.586L16 7.414V10h-4V6z" />
      </svg>
    ),
  },
  {
    href: '/admin/reports',
    labelKey: 'common.nav.reports',
    iconBg: 'bg-brand/10',
    iconColor: 'text-brand',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm2 10a1 1 0 10-2 0v3a1 1 0 102 0v-3zm2-3a1 1 0 011 1v5a1 1 0 11-2 0v-5a1 1 0 011-1zm4-1a1 1 0 10-2 0v6a1 1 0 102 0V8z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/admin/settings',
    labelKey: 'common.nav.settings',
    iconBg: 'bg-blue/10',
    iconColor: 'text-blue',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
      </svg>
    ),
  },
  {
    href: '/admin/ai',
    labelKey: 'AI',
    iconBg: 'bg-amber/10',
    iconColor: 'text-amber',
    icon: (
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
    ),
  },
]

const DEFAULT_HREFS = [
  '/admin/team-clock',
  '/admin/approvals',
  '/admin/payroll',
  '/admin/projects',
]
const LS_KEY = 'orbit_admin_quick_actions'
const MAX = 6

const XIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
  </svg>
)

const PlusIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
    <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
  </svg>
)

export function QuickActionsWidget() {
  const { t } = useTranslation()
  const [selectedHrefs, setSelectedHrefs] = useState<string[]>(DEFAULT_HREFS)
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LS_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as string[]
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSelectedHrefs(parsed)
        }
      }
    } catch {}
  }, [])

  const persist = useCallback((hrefs: string[]) => {
    setSelectedHrefs(hrefs)
    try { localStorage.setItem(LS_KEY, JSON.stringify(hrefs)) } catch {}
  }, [])

  const addAction = (href: string) => {
    if (selectedHrefs.length < MAX && !selectedHrefs.includes(href)) {
      persist([...selectedHrefs, href])
    }
  }

  const removeAction = (href: string) => {
    persist(selectedHrefs.filter(h => h !== href))
  }

  const selected = selectedHrefs
    .map(h => ALL_ACTIONS.find(a => a.href === h))
    .filter((a): a is Action => !!a)

  const available = ALL_ACTIONS.filter(a => !selectedHrefs.includes(a.href))

  const cols = selected.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'

  return (
    <div className="mb-6 md:mb-8">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-secondary uppercase tracking-wide">
          {t('admin.dashboard.quickActions')}
        </p>
        <button
          onClick={() => setEditOpen(true)}
          className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium transition-colors"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
          </svg>
          Customize
        </button>
      </div>

      <div className={`grid ${cols} md:grid-cols-4 gap-3`}>
        {selected.map(action => (
          <Link
            key={action.href}
            href={action.href}
            className="flex flex-col items-center gap-3 p-4 rounded-card bg-surface border border-[var(--border)] hover:border-brand/30 hover:bg-surface-elevated transition-colors"
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${action.iconBg}`}>
              <span className={action.iconColor}>{action.icon}</span>
            </div>
            <span className="text-sm font-medium text-primary text-center leading-tight">
              {t(action.labelKey)}
            </span>
          </Link>
        ))}
      </div>

      {/* Backdrop */}
      <div
        className={[
          'fixed inset-0 z-50 bg-black/50 transition-opacity duration-300',
          editOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
        ].join(' ')}
        onClick={() => setEditOpen(false)}
      />

      {/* Customize sheet */}
      <div
        className={[
          'fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl shadow-2xl transition-transform duration-300 ease-out overflow-hidden',
          editOpen ? 'translate-y-0' : 'translate-y-full',
        ].join(' ')}
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-[var(--border)]" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <div>
            <p className="text-sm font-semibold text-primary">Customize Quick Actions</p>
            <p className="text-xs text-secondary mt-0.5">{selected.length} of {MAX} selected</p>
          </div>
          <button
            onClick={() => setEditOpen(false)}
            className="p-1.5 rounded-button text-secondary hover:text-primary hover:bg-surface-elevated transition-colors"
          >
            <XIcon />
          </button>
        </div>

        <div className="overflow-y-auto max-h-[60vh] px-4 py-4 space-y-5">
          {/* Active */}
          {selected.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-tertiary uppercase tracking-widest mb-2 px-1">Active</p>
              <div className="space-y-1.5">
                {selected.map(action => (
                  <div
                    key={action.href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-brand/5 border border-brand/15"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${action.iconBg}`}>
                      <span className={`${action.iconColor} [&>svg]:w-4 [&>svg]:h-4`}>{action.icon}</span>
                    </div>
                    <span className="flex-1 text-sm font-medium text-primary">{t(action.labelKey)}</span>
                    <button
                      onClick={() => removeAction(action.href)}
                      className="p-1.5 rounded-full text-tertiary hover:text-danger hover:bg-danger/10 transition-colors"
                      aria-label="Remove"
                    >
                      <XIcon />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Available */}
          {available.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-tertiary uppercase tracking-widest mb-2 px-1">
                {selected.length >= MAX ? `Max ${MAX} reached` : 'Add more'}
              </p>
              <div className="space-y-1.5">
                {available.map(action => (
                  <button
                    key={action.href}
                    onClick={() => addAction(action.href)}
                    disabled={selected.length >= MAX}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[var(--border)] hover:border-brand/30 hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${action.iconBg}`}>
                      <span className={`${action.iconColor} [&>svg]:w-4 [&>svg]:h-4`}>{action.icon}</span>
                    </div>
                    <span className="flex-1 text-left text-sm font-medium text-secondary">{t(action.labelKey)}</span>
                    <span className="text-tertiary flex-shrink-0"><PlusIcon /></span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
