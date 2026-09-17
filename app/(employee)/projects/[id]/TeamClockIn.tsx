'use client'

import { useState, useCallback, useEffect } from 'react'
import { supervisorClockIn, supervisorClockOut, getProjectTeamStatus } from '@/app/actions/workerActions'
import { useTranslation } from '@/lib/i18n/LocaleContext'

interface TeamMember {
  kind: 'profile' | 'worker'
  id: string
  full_name: string
  daily_rate: number
  entry: { id: string; clock_in: string; notes: string | null } | null
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function ClockOutSheet({
  member,
  onClose,
  onDone,
}: {
  member: TeamMember
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [isFullDay, setIsFullDay] = useState(true)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleClockOut() {
    if (!member.entry) return
    setSaving(true)
    setError('')
    const res = await supervisorClockOut({ entryId: member.entry.id, isFullDay, notes })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onDone()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm md:flex md:items-center md:justify-center"
      onClick={onClose}
    >
      <div
        className="absolute bottom-0 left-0 right-0 md:static md:w-full md:max-w-lg bg-surface rounded-t-[20px] md:rounded-[20px] flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 overflow-y-auto flex-1">
          <div className="w-10 h-1 bg-tertiary rounded-full mx-auto mb-4 md:hidden" />
          <h3 className="text-base font-semibold text-primary mb-1">{member.full_name}</h3>
          {member.entry && (
            <p className="text-xs text-secondary mb-4">
              {t('supervisor.clockIn.clockedInAt')} {fmtTime(member.entry.clock_in)}
            </p>
          )}

          <div className="mb-4">
            <p className="text-xs font-medium text-secondary mb-2">{t('supervisor.clockIn.fullDayQuestion')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => setIsFullDay(true)}
                className={`flex-1 py-2.5 rounded-button text-sm font-medium border transition-colors ${
                  isFullDay
                    ? 'bg-brand text-white border-brand'
                    : 'bg-surface border-[var(--border)] text-secondary'
                }`}
              >
                {t('supervisor.clockIn.fullDay')}
              </button>
              <button
                onClick={() => setIsFullDay(false)}
                className={`flex-1 py-2.5 rounded-button text-sm font-medium border transition-colors ${
                  !isFullDay
                    ? 'bg-amber text-white border-amber'
                    : 'bg-surface border-[var(--border)] text-secondary'
                }`}
              >
                {t('supervisor.clockIn.partialDay')}
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="text-xs font-medium text-secondary block mb-1.5">
              {t('supervisor.clockIn.notesOptional')}
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder={t('supervisor.clockIn.notesPlaceholder')}
              className="w-full bg-surface-elevated border border-[var(--border)] rounded-button px-3 py-2.5 text-sm text-primary placeholder:text-tertiary resize-none focus:outline-none focus:border-brand"
            />
          </div>

          {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        </div>

        <div className="px-5 pt-3 shrink-0" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}>
          <button
            onClick={handleClockOut}
            disabled={saving}
            className="w-full py-3 bg-red-500 text-white rounded-button font-semibold text-sm disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('supervisor.clockIn.clockOut')}
          </button>
        </div>
      </div>
    </div>
  )
}

function ClockInSheet({
  member,
  onClose,
  onDone,
  projectId,
}: {
  member: TeamMember
  onClose: () => void
  onDone: () => void
  projectId: string
}) {
  const { t } = useTranslation()
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleClockIn() {
    setSaving(true)
    setError('')
    const res = await supervisorClockIn({
      projectId,
      profileId: member.kind === 'profile' ? member.id : undefined,
      workerId: member.kind === 'worker' ? member.id : undefined,
      notes,
    })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    onDone()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm md:flex md:items-center md:justify-center"
      onClick={onClose}
    >
      <div
        className="absolute bottom-0 left-0 right-0 md:static md:w-full md:max-w-lg bg-surface rounded-t-[20px] md:rounded-[20px] flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-5 overflow-y-auto flex-1">
          <div className="w-10 h-1 bg-tertiary rounded-full mx-auto mb-4 md:hidden" />
          <h3 className="text-base font-semibold text-primary mb-1">{member.full_name}</h3>
          <p className="text-xs text-secondary mb-4">
            ${member.daily_rate.toFixed(2)} {t('supervisor.clockIn.perDay')}
          </p>

          <div className="mb-4">
            <label className="text-xs font-medium text-secondary block mb-1.5">
              {t('supervisor.clockIn.notesOptional')}
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder={t('supervisor.clockIn.notesPlaceholder')}
              className="w-full bg-surface-elevated border border-[var(--border)] rounded-button px-3 py-2.5 text-sm text-primary placeholder:text-tertiary resize-none focus:outline-none focus:border-brand"
            />
          </div>

          {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        </div>

        <div className="px-5 pt-3 shrink-0" style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom, 0px))' }}>
          <button
            onClick={handleClockIn}
            disabled={saving}
            className="w-full py-3 bg-green text-white rounded-button font-semibold text-sm disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('supervisor.clockIn.clockIn')}
          </button>
        </div>
      </div>
    </div>
  )
}

export function TeamClockIn({ projectId }: { projectId: string }) {
  const { t } = useTranslation()
  const [team, setTeam] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null)
  const [sheetMode, setSheetMode] = useState<'in' | 'out' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await getProjectTeamStatus(projectId)
    setLoading(false)
    if (res.error) { setError(res.error); return }
    setTeam(res.team ?? [])
  }, [projectId])

  useEffect(() => { load() }, [load])

  function openSheet(member: TeamMember) {
    setSelectedMember(member)
    setSheetMode(member.entry ? 'out' : 'in')
  }

  function closeSheet() {
    setSelectedMember(null)
    setSheetMode(null)
  }

  async function handleDone() {
    closeSheet()
    await load()
  }

  const clockedIn  = team.filter(m => m.entry)
  const clockedOut = team.filter(m => !m.entry)

  if (loading) {
    return (
      <div className="px-4 py-8 text-center text-sm text-secondary">
        {t('common.loading')}
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-6 text-center text-sm text-red-500">{error}</div>
    )
  }

  if (team.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-secondary">
        {t('supervisor.clockIn.noTeam')}
      </div>
    )
  }

  return (
    <>
      <div className="px-4 pb-6">
        {clockedIn.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">
              {t('supervisor.clockIn.clockedIn')} · {clockedIn.length}
            </p>
            <div className="flex flex-col gap-2">
              {clockedIn.map(member => (
                <button
                  key={member.id}
                  onClick={() => openSheet(member)}
                  className="flex items-center justify-between w-full bg-green/10 border border-green/20 rounded-[14px] px-4 py-3 text-left"
                >
                  <div>
                    <p className="text-sm font-medium text-primary">{member.full_name}</p>
                    <p className="text-xs text-secondary mt-0.5">
                      {t('supervisor.clockIn.since')} {fmtTime(member.entry!.clock_in)}
                      {member.entry!.notes ? ` · ${member.entry!.notes}` : ''}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-green bg-green/15 px-2.5 py-1 rounded-full">
                    {t('supervisor.clockIn.tapToClockOut')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {clockedOut.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2">
              {t('supervisor.clockIn.notClockedIn')} · {clockedOut.length}
            </p>
            <div className="flex flex-col gap-2">
              {clockedOut.map(member => (
                <button
                  key={member.id}
                  onClick={() => openSheet(member)}
                  className="flex items-center justify-between w-full bg-surface border border-[var(--border)] rounded-[14px] px-4 py-3 text-left"
                >
                  <div>
                    <p className="text-sm font-medium text-primary">{member.full_name}</p>
                    <p className="text-xs text-secondary mt-0.5">
                      ${member.daily_rate.toFixed(2)}{t('supervisor.clockIn.perDay')}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-brand border border-brand px-2.5 py-1 rounded-full">
                    {t('supervisor.clockIn.tapToClockIn')}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedMember && sheetMode === 'out' && (
        <ClockOutSheet
          member={selectedMember}
          onClose={closeSheet}
          onDone={handleDone}
        />
      )}
      {selectedMember && sheetMode === 'in' && (
        <ClockInSheet
          member={selectedMember}
          onClose={closeSheet}
          onDone={handleDone}
          projectId={projectId}
        />
      )}
    </>
  )
}
