'use client'

import { writeFailed } from '@/lib/write-feedback'
import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { updateProfile, changeMyPassword } from '@/app/actions/profile'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Avatar } from '@/components/ui/Avatar'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import type { Language } from '@/lib/auth/types'

interface Profile {
  id: string
  full_name: string
  email: string
  phone: string | null
  avatar_url: string | null
  language: Language
  email_notifications: boolean
  role: string
}

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português' },
  { value: 'es', label: 'Español' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-primary mb-3">{title}</h2>
      {children}
    </div>
  )
}

export function ProfileForm({ initialProfile }: { initialProfile: Profile }) {
  const router = useRouter()
  const { t } = useTranslation()
  const [form, setForm] = useState({
    full_name: initialProfile.full_name,
    phone: initialProfile.phone ?? '',
    language: initialProfile.language,
    email_notifications: initialProfile.email_notifications,
  })
  const [avatarUrl, setAvatarUrl] = useState(initialProfile.avatar_url)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [pwSaving, setPwSaving] = useState(false)
  const [pwSaved, setPwSaved] = useState(false)
  const [pwError, setPwError] = useState('')

  async function handleAvatarUpload(files: FileList | null) {
    if (!files || files.length === 0) return
    setUploadingAvatar(true)
    const supabase = createClient()
    const file = files[0]
    const ext = file.name.split('.').pop()
    const path = `avatars/${initialProfile.id}/${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage.from('project-photos').upload(path, file, { upsert: true })
    if (!uploadErr) {
      const { data } = supabase.storage.from('project-photos').getPublicUrl(path)
      setAvatarUrl(data.publicUrl)
    } else writeFailed(uploadErr, 'upload your photo')
    setUploadingAvatar(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaved(false)
    setSaving(true)
    const result = await updateProfile({ ...form, avatar_url: avatarUrl })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    router.refresh()
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault()
    setPwError('')
    setPwSaved(false)
    setPwSaving(true)
    const result = await changeMyPassword(pw)
    setPwSaving(false)
    if (result.error) {
      setPwError(result.error)
      return
    }
    setPw({ current_password: '', new_password: '', confirm_password: '' })
    setPwSaved(true)
    setTimeout(() => setPwSaved(false), 2000)
  }

  return (
    <div>
      <Section title={t('profile.photo')}>
        <Card>
          <div className="flex items-center gap-4">
            <Avatar src={avatarUrl} name={form.full_name} size="xl" />
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} loading={uploadingAvatar}>
                {avatarUrl ? t('profile.changePhoto') : t('profile.uploadPhoto')}
              </Button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => handleAvatarUpload(e.target.files)} />
            </div>
          </div>
        </Card>
      </Section>

      <form onSubmit={handleSave}>
        <Section title={t('profile.yourInfo')}>
          <Card className="space-y-4">
            <Input
              label={t('profile.fullName')}
              required
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
            />
            <Input label={t('profile.email')} value={initialProfile.email} disabled />
            <Input
              label={t('profile.phone')}
              type="tel"
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            />
          </Card>
        </Section>

        <Section title={t('profile.language')}>
          <Card>
            <Select
              label={t('profile.appLanguage')}
              options={LANGUAGE_OPTIONS}
              value={form.language}
              onChange={e => setForm(f => ({ ...f, language: e.target.value as Language }))}
            />
            <p className="text-xs text-tertiary mt-2">
              {t('profile.languageDisclaimer')}
            </p>
          </Card>
        </Section>

        <Section title={t('profile.notifications')}>
          <Card>
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-primary">{t('profile.emailNotifications')}</p>
                <p className="text-xs text-tertiary mt-0.5">{t('profile.emailNotificationsDesc')}</p>
              </div>
              <input
                type="checkbox"
                checked={form.email_notifications}
                onChange={e => setForm(f => ({ ...f, email_notifications: e.target.checked }))}
                className="w-5 h-5 rounded accent-brand"
              />
            </label>
            <p className="text-xs text-tertiary mt-3">{t('profile.notificationsDisclaimer')}</p>
          </Card>
        </Section>

        {error && (
          <div className="bg-danger/10 border border-danger/20 rounded-input px-4 py-3 text-sm text-danger mb-4">
            {error}
          </div>
        )}

        <Button type="submit" loading={saving} className="w-full">
          {saved ? t('profile.saved') : t('profile.saveChanges')}
        </Button>
      </form>

      <div className="mt-8">
        <Section title={t('profile.changePassword')}>
          <Card>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <Input
                label={t('profile.currentPassword')}
                type="password"
                required
                value={pw.current_password}
                onChange={e => setPw(f => ({ ...f, current_password: e.target.value }))}
              />
              <Input
                label={t('profile.newPassword')}
                type="password"
                required
                placeholder={t('profile.newPasswordHint')}
                value={pw.new_password}
                onChange={e => setPw(f => ({ ...f, new_password: e.target.value }))}
              />
              <Input
                label={t('profile.confirmNewPassword')}
                type="password"
                required
                value={pw.confirm_password}
                onChange={e => setPw(f => ({ ...f, confirm_password: e.target.value }))}
              />
              {pwError && (
                <div className="bg-danger/10 border border-danger/20 rounded-input px-4 py-3 text-sm text-danger">
                  {pwError}
                </div>
              )}
              <Button type="submit" variant="secondary" loading={pwSaving} className="w-full">
                {pwSaved ? t('profile.passwordChanged') : t('profile.changePassword')}
              </Button>
            </form>
          </Card>
        </Section>
      </div>
    </div>
  )
}
