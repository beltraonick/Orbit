'use client'

import Link from 'next/link'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { useIsNativeApp } from '@/lib/use-native-app'
import type { AccessState } from '@/lib/billing'

// Top-of-screen notice about the company's plan: trial ending, payment
// failed, or trial over (team can't clock in). Inside the iOS app it never
// shows prices or a way to pay — only that the account needs attention.

export function AccountBanner({
  role,
  state,
  blocked,
  trialDaysLeft,
  subscribed,
}: {
  role: 'admin' | 'employee'
  state: AccessState
  blocked: boolean
  trialDaysLeft: number | null
  subscribed: boolean
}) {
  const { t } = useTranslation()
  const native = useIsNativeApp()
  const b = (key: string, n?: number) => t(`admin.billing.${key}`).split('{n}').join(String(n ?? ''))

  let tone: 'red' | 'amber' | null = null
  let text = ''
  let link: { href: string; label: string } | null = null

  if (role === 'employee') {
    if (!blocked) return null
    tone = 'red'
    text = b('bannerEmployee')
  } else if (blocked) {
    tone = 'red'
    text = native ? b('bannerAttention') : b('bannerBlocked')
    link = { href: '/admin/settings#plan', label: b('choosePlanLink') }
  } else if (state === 'past_due') {
    tone = 'amber'
    text = native ? b('bannerAttention') : b('bannerPastDue')
    link = { href: '/admin/settings#plan', label: b('updateCardLink') }
  } else if (state === 'trial' && !subscribed && trialDaysLeft != null && trialDaysLeft <= 9) {
    if (native !== false) return null // trial reminders are a website thing
    tone = 'amber'
    text = b('bannerTrialEnding', trialDaysLeft)
    link = { href: '/admin/settings#plan', label: b('choosePlanLink') }
  }

  if (!tone) return null
  const cls = tone === 'red' ? 'bg-danger/10 border-danger/30 text-danger' : 'bg-amber/10 border-amber/30 text-primary'

  return (
    <div className={`mx-4 md:mx-8 mt-3 rounded-input border px-4 py-3 text-sm flex items-center justify-between gap-3 flex-wrap ${cls}`} role="status">
      <span>{text}</span>
      {link && native === false && (
        <Link href={link.href} className="font-semibold underline whitespace-nowrap">{link.label}</Link>
      )}
    </div>
  )
}
