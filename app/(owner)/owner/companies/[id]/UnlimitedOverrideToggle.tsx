'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { setUnlimitedOverride } from '@/app/actions/owner'
import { useTranslation } from '@/lib/i18n/LocaleContext'

export function UnlimitedOverrideToggle({
  companyId,
  initialEnabled,
}: {
  companyId: string
  initialEnabled: boolean
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function toggle() {
    setSaving(true)
    setError('')
    const next = !enabled
    const result = await setUnlimitedOverride(companyId, next)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setEnabled(next)
    router.refresh()
  }

  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div>
        <p className="text-sm font-medium text-primary">
          {enabled ? t('owner.companyDetail.unlimitedActive') : t('owner.companyDetail.unlimitedInactive')}
        </p>
        <p className="text-xs text-secondary mt-0.5">{t('owner.companyDetail.unlimitedDescription')}</p>
        {error && <p className="text-xs text-danger mt-1">{error}</p>}
      </div>
      <button
        onClick={toggle}
        disabled={saving}
        className={`px-4 py-2 rounded-button text-sm font-medium transition-colors disabled:opacity-60 ${
          enabled
            ? 'bg-surface-elevated border border-[var(--border)] text-secondary hover:text-primary'
            : 'bg-brand text-white hover:bg-brand-hover'
        }`}
      >
        {saving ? t('common.saving') : enabled ? t('owner.companyDetail.revokeUnlimited') : t('owner.companyDetail.grantUnlimited')}
      </button>
    </div>
  )
}
