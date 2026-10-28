'use client'

import { useState, useEffect, useCallback } from 'react'
import { getPendingRequests, approveMember, rejectMember } from '@/app/actions/membership'
import { getCompanyInviteCode } from '@/app/actions/invites'
import type { MembershipRequest } from '@/app/actions/membership'
import { Card } from '@/components/ui/Card'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/lib/i18n/LocaleContext'

export default function MembersPage() {
  const { t } = useTranslation()
  const [requests, setRequests] = useState<MembershipRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [membersResult, codeResult] = await Promise.all([
      getPendingRequests(),
      getCompanyInviteCode(),
    ])
    if (membersResult.error) setError(membersResult.error)
    if (membersResult.requests) setRequests(membersResult.requests)
    if (codeResult.code) {
      setInviteLink(`${window.location.origin}/register?code=${codeResult.code}`)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleCopyLink() {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
    } catch {
      const el = document.createElement('textarea')
      el.value = inviteLink
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleApprove(id: string) {
    setProcessing(id)
    setError('')
    const result = await approveMember(id)
    if (result.error) setError(result.error)
    else await load()
    setProcessing(null)
  }

  async function handleReject(id: string) {
    setProcessing(id)
    setError('')
    const result = await rejectMember(id)
    if (result.error) setError(result.error)
    else await load()
    setProcessing(null)
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{t('admin.members.title')}</h1>
        <p className="text-sm text-secondary mt-1">
          {t('admin.members.subtitle')}
        </p>
      </div>

      {/* Invite link card */}
      <Card className="mb-6">
        <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-3">{t('admin.members.inviteLinkTitle')}</p>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0 bg-surface rounded-input border border-[var(--border)] px-3 py-2">
            <p className="text-xs text-primary truncate font-mono select-all">{inviteLink || '…'}</p>
          </div>
          <Button
            onClick={handleCopyLink}
            disabled={!inviteLink}
            className="flex-shrink-0 text-xs px-4 py-2 h-auto"
          >
            {copied ? t('admin.members.linkCopied') : t('admin.members.copyLink')}
          </Button>
        </div>
        <p className="text-xs text-secondary mt-2">{t('admin.members.inviteLinkHint')}</p>
      </Card>

      {error && (
        <div className="mb-4 bg-danger/10 border border-danger/20 rounded-input px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <Card>
          <p className="text-sm text-secondary text-center py-4">{t('common.loading')}</p>
        </Card>
      ) : requests.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full bg-green/10 border border-green/20 flex items-center justify-center mx-auto mb-4">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-7 h-7 text-green">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <p className="text-sm font-medium text-primary">{t('admin.members.noPendingRequests')}</p>
            <p className="text-xs text-secondary mt-1">{t('admin.members.allReviewed')}</p>
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <div className="divide-y divide-[var(--border)]">
            {requests.map(req => {
              const profile = req.profiles
              const isProcessing = processing === req.id
              return (
                <div key={req.id} className="flex items-center gap-4 px-5 py-4">
                  <Avatar name={profile.full_name} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-primary truncate">{profile.full_name}</p>
                    <p className="text-xs text-secondary truncate">{profile.email}</p>
                    {profile.phone && (
                      <p className="text-xs text-tertiary">{profile.phone}</p>
                    )}
                    <p className="text-xs text-tertiary mt-0.5">
                      {t('admin.members.requestedOn').replace('{date}', new Date(req.created_at).toLocaleDateString())}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="secondary"
                      onClick={() => handleReject(req.id)}
                      disabled={isProcessing}
                      className="text-xs px-3 py-1.5 h-auto"
                    >
                      {t('admin.members.reject')}
                    </Button>
                    <Button
                      onClick={() => handleApprove(req.id)}
                      disabled={isProcessing}
                      loading={isProcessing}
                      className="text-xs px-3 py-1.5 h-auto"
                    >
                      {t('admin.members.approve')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <div className="mt-6 bg-surface rounded-card border border-[var(--border)] p-4">
        <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">{t('admin.members.howItWorks')}</p>
        <ul className="space-y-1.5">
          {[
            t('admin.members.step1'),
            t('admin.members.step2'),
            t('admin.members.step3'),
          ].map((text, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="w-4 h-4 rounded-full bg-brand/20 text-brand text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span className="text-xs text-secondary">{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
