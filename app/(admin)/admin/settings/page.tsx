'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { getCompanyInviteCode, regenerateInviteCode } from '@/app/actions/invites'
import { getCompanyPlan, changeCompanyPlan, type CompanyPlanInfo } from '@/app/actions/company-plan'
import { subscriptionStatusKey, subscriptionStatusVariant } from '@/lib/owner-status'
import { useTranslation } from '@/lib/i18n/LocaleContext'
import { useCompanyId } from '@/lib/company-context'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_CLOCK_WINDOW, COMMON_TIMEZONES } from '@/lib/clock-window'
import { getPeriodRange, loadCompanyPeriodSettings, toDateStr } from '@/lib/employee-period'

const VERSION = '1.0.0'

const PLAN_CHOICES: { key: 'free' | 'starter' | 'growth'; name: string; price: string; blurb: string }[] = [
  { key: 'free', name: 'Free', price: '$0/mo', blurb: 'Up to 4 projects, 3 employees' },
  { key: 'starter', name: 'Starter', price: '$49/mo', blurb: 'Unlimited projects, most popular' },
  { key: 'growth', name: 'Growth', price: '$99/mo', blurb: 'More admins & employees, priority support' },
]

// ─── QuickBooks Integration ────────────────────────────────────────────────────

interface QBOStatus {
  connected: boolean
  realmId?: string
  connectedAt?: string
  stats?: { total: number; success: number; failed: number; lastSync: string | null; pending: number }
  recentLogs?: Array<{ status: string; attempted_at: string; error_message: string | null; synced_at: string | null }>
}

interface QBOEmployee { Id: string; DisplayName: string }
interface QBOProfile { id: string; full_name: string; email: string }
interface QBOMapping { profile_id: string; qbo_employee_id: string; qbo_employee_name: string | null }

function QBOIntegrationSection() {
  const [status, setStatus] = useState<QBOStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [disconnecting, setDisconnecting] = useState(false)

  // Employee mapping state
  const [showMapping, setShowMapping] = useState(false)
  const [loadingMapping, setLoadingMapping] = useState(false)
  const [qboEmployees, setQboEmployees] = useState<QBOEmployee[]>([])
  const [profiles, setProfiles] = useState<QBOProfile[]>([])
  const [mappings, setMappings] = useState<QBOMapping[]>([])
  const [savingMap, setSavingMap] = useState<string | null>(null)

  // Pending sync
  const [syncing, setSyncing] = useState(false)

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const res = await fetch('/api/qbo/status')
      if (res.ok) setStatus(await res.json())
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => {
    // Show QBO result toast from OAuth redirect
    const params = new URLSearchParams(window.location.search)
    const qbo = params.get('qbo')
    if (qbo) {
      const url = new URL(window.location.href)
      url.searchParams.delete('qbo')
      url.searchParams.delete('reason')
      window.history.replaceState({}, '', url.toString())
    }
    fetchStatus()
  }, [fetchStatus])

  async function handleDisconnect() {
    if (!window.confirm('Desconectar o QuickBooks? As entradas já sincronizadas permanecem no QBO.')) return
    setDisconnecting(true)
    try {
      await fetch('/api/qbo/disconnect', { method: 'POST' })
      await fetchStatus()
      setShowMapping(false)
    } finally {
      setDisconnecting(false)
    }
  }

  async function loadMapping() {
    setLoadingMapping(true)
    try {
      const res = await fetch('/api/qbo/employees')
      if (res.ok) {
        const data = await res.json()
        setQboEmployees(data.qboEmployees ?? [])
        setProfiles(data.profiles ?? [])
        setMappings(data.mappings ?? [])
      }
    } finally {
      setLoadingMapping(false)
    }
  }

  function toggleMapping() {
    if (!showMapping && profiles.length === 0) loadMapping()
    setShowMapping(v => !v)
  }

  function getMapped(profileId: string) {
    return mappings.find(m => m.profile_id === profileId)
  }

  async function handleMapChange(profileId: string, qboId: string, qboName: string) {
    setSavingMap(profileId)
    try {
      if (qboId === '') {
        await fetch('/api/qbo/employee-map', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile_id: profileId }),
        })
        setMappings(prev => prev.filter(m => m.profile_id !== profileId))
      } else {
        await fetch('/api/qbo/employee-map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profile_id: profileId, qbo_employee_id: qboId, qbo_employee_name: qboName }),
        })
        setMappings(prev => {
          const without = prev.filter(m => m.profile_id !== profileId)
          return [...without, { profile_id: profileId, qbo_employee_id: qboId, qbo_employee_name: qboName }]
        })
      }
    } finally {
      setSavingMap(null)
    }
  }

  async function handleSyncPending() {
    setSyncing(true)
    try {
      // Fetch all not_synced completed entries and sync them one by one
      const res = await fetch('/api/qbo/status')
      const statusData = await res.json()
      if (!statusData.stats?.pending) { setSyncing(false); return }

      // The sync endpoint handles individual entries; for bulk we call a simple loop
      // by fetching pending IDs from Supabase client-side. For simplicity, let the
      // admin trigger individual sync via a server action — or reload after a moment.
      // For V1, just POST to sync with no body to trigger a batch on the server.
      await fetch('/api/qbo/sync/batch', { method: 'POST' }).catch(() => {})
      await fetchStatus()
    } finally {
      setSyncing(false)
    }
  }

  if (loadingStatus) {
    return (
      <Card>
        <div className="h-14 bg-surface-elevated rounded-input animate-pulse" />
      </Card>
    )
  }

  return (
    <Card padding="none">
      {/* Header row */}
      <div className="px-5 py-4 flex items-center gap-3">
        {/* QuickBooks logo mark — green gradient Q */}
        <div className="w-10 h-10 rounded-[10px] flex items-center justify-center flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #2CA01C 0%, #1A7312 100%)' }}>
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="white">
            <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm.5 14.5h-1v-2.09A4.502 4.502 0 0 1 7.5 10a4.5 4.5 0 0 1 4.5-4.5V7a3 3 0 1 0 0 6v-1.5h1v5z"/>
          </svg>
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-primary">QuickBooks Online</p>
          <p className="text-xs text-secondary">Sincronização de horas de trabalho</p>
        </div>
        <Badge variant={status?.connected ? 'green' : 'gray'}>
          {status?.connected ? 'Conectado' : 'Desconectado'}
        </Badge>
      </div>

      <div className="border-t border-[var(--border)]" />

      {status?.connected ? (
        <div className="px-5 py-4 space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-elevated rounded-input px-3 py-2.5 text-center">
              <p className="text-lg font-bold text-primary">{status.stats?.success ?? 0}</p>
              <p className="text-xs text-secondary mt-0.5">Sincronizadas</p>
            </div>
            <div className="bg-surface-elevated rounded-input px-3 py-2.5 text-center">
              <p className="text-lg font-bold text-amber">{status.stats?.pending ?? 0}</p>
              <p className="text-xs text-secondary mt-0.5">Pendentes</p>
            </div>
            <div className="bg-surface-elevated rounded-input px-3 py-2.5 text-center">
              <p className="text-lg font-bold text-red">{status.stats?.failed ?? 0}</p>
              <p className="text-xs text-secondary mt-0.5">Falhas</p>
            </div>
          </div>

          {status.stats?.lastSync && (
            <p className="text-xs text-secondary">
              Última sincronização: {new Date(status.stats.lastSync).toLocaleString('pt-BR')}
            </p>
          )}

          {/* Recent log (last 5) */}
          {(status.recentLogs?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-secondary">Últimas sincronizações</p>
              <div className="divide-y divide-[var(--border)] rounded-input border border-[var(--border)] overflow-hidden">
                {status.recentLogs!.slice(0, 5).map((log, i) => (
                  <div key={i} className="px-3 py-2 flex items-center gap-2 bg-surface-elevated/50">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      log.status === 'success' ? 'bg-green' :
                      log.status === 'failed' ? 'bg-red' :
                      log.status === 'skipped' ? 'bg-amber' : 'bg-secondary'
                    }`} />
                    <span className="text-xs text-secondary flex-1 min-w-0 truncate">
                      {log.status === 'failed' && log.error_message
                        ? log.error_message
                        : log.status === 'success'
                        ? 'Sincronizado com sucesso'
                        : log.status === 'skipped'
                        ? 'Ignorado (funcionário não mapeado)'
                        : 'Pendente'}
                    </span>
                    <span className="text-xs text-tertiary flex-shrink-0">
                      {new Date(log.attempted_at).toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="secondary"
              onClick={toggleMapping}
              className="flex-1"
            >
              {showMapping ? 'Ocultar mapeamento' : 'Mapear funcionários'}
            </Button>
            {(status.stats?.pending ?? 0) > 0 && (
              <Button
                variant="secondary"
                onClick={handleSyncPending}
                loading={syncing}
                className="flex-1"
              >
                Sincronizar pendentes ({status.stats!.pending})
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={handleDisconnect}
              loading={disconnecting}
              className="flex-1 text-red hover:bg-red/10"
            >
              Desconectar
            </Button>
          </div>

          {/* Employee mapping panel */}
          {showMapping && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-secondary">
                Mapeie cada funcionário do Orbit para o Employee correspondente no QuickBooks.
                Funcionários sem mapeamento são ignorados no sync.
              </p>
              {loadingMapping ? (
                <div className="h-10 bg-surface-elevated rounded-input animate-pulse" />
              ) : (
                <div className="divide-y divide-[var(--border)] rounded-input border border-[var(--border)] overflow-hidden">
                  {profiles.map(profile => {
                    const mapped = getMapped(profile.id)
                    return (
                      <div key={profile.id} className="px-3 py-3 flex items-center gap-3 bg-surface-elevated/50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-primary truncate">{profile.full_name}</p>
                          <p className="text-xs text-secondary truncate">{profile.email}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <select
                            className="text-xs bg-surface border border-[var(--border)] rounded-input px-2 py-1.5 text-primary max-w-[160px]"
                            value={mapped?.qbo_employee_id ?? ''}
                            disabled={savingMap === profile.id}
                            onChange={e => {
                              const sel = qboEmployees.find(emp => emp.Id === e.target.value)
                              handleMapChange(profile.id, e.target.value, sel?.DisplayName ?? '')
                            }}
                          >
                            <option value="">— Não mapeado —</option>
                            {qboEmployees.map(emp => (
                              <option key={emp.Id} value={emp.Id}>{emp.DisplayName}</option>
                            ))}
                          </select>
                          {savingMap === profile.id && (
                            <span className="w-4 h-4 rounded-full border-2 border-brand border-t-transparent animate-spin flex-shrink-0" />
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {profiles.length === 0 && (
                    <div className="px-3 py-4 text-xs text-secondary text-center">
                      Nenhum funcionário cadastrado no Orbit ainda.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-secondary">
            Conecte sua conta QuickBooks Online para sincronizar automaticamente as horas
            de trabalho após cada batida de ponto. Apenas dados de tempo são enviados —
            nenhuma informação financeira é compartilhada.
          </p>
          <a href="/api/qbo/connect">
            <Button className="w-full" variant="primary">
              Conectar QuickBooks Online
            </Button>
          </a>
        </div>
      )}
    </Card>
  )
}

const ACCOUNTS = [
  { roleKey: 'roleAdmin' as const, email: 'admin@orbit.test', password: 'Admin123!' },
  { roleKey: 'employee' as const, email: 'employee@orbit.test', password: 'Employee123!' },
  { roleKey: 'client' as const, email: 'client@orbit.test', password: 'Client123!' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-primary mb-3">{title}</h2>
      {children}
    </div>
  )
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const companyId = useCompanyId()
  const [copied, setCopied] = useState('')
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(true)
  const [inviteRegenerating, setInviteRegenerating] = useState(false)
  const [planInfo, setPlanInfo] = useState<CompanyPlanInfo | null>(null)
  const [planLoading, setPlanLoading] = useState(true)
  const [changingPlan, setChangingPlan] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<'free' | 'starter' | 'growth'>('starter')
  const [savingPlan, setSavingPlan] = useState(false)
  const [planSaved, setPlanSaved] = useState(false)

  // Company settings state
  const [companyName, setCompanyName] = useState('')
  const [defaultHourlyRate, setDefaultHourlyRate] = useState('')
  const [companyLoading, setCompanyLoading] = useState(true)
  const [companySaving, setCompanySaving] = useState(false)
  const [companySaved, setCompanySaved] = useState(false)

  // Mileage rate state
  const [mileageRate, setMileageRate] = useState('')
  const [mileageRateLoading, setMileageRateLoading] = useState(true)
  const [mileageRateSaving, setMileageRateSaving] = useState(false)
  const [mileageRateSaved, setMileageRateSaved] = useState(false)

  // Clock-in/out window state
  const [clockWindow, setClockWindow] = useState({ ...DEFAULT_CLOCK_WINDOW })
  const [clockWindowLoading, setClockWindowLoading] = useState(true)
  const [clockWindowSaving, setClockWindowSaving] = useState(false)
  const [clockWindowSaved, setClockWindowSaved] = useState(false)

  // Dashboard period state
  const [homePeriodType, setHomePeriodType] = useState<'weekly' | 'biweekly' | 'monthly'>('biweekly')
  const [homePeriodLoading, setHomePeriodLoading] = useState(true)
  const [homePeriodSaving, setHomePeriodSaving] = useState(false)
  const [homePeriodSaved, setHomePeriodSaved] = useState(false)
  const [periodAnchor, setPeriodAnchor] = useState('')
  const [homePeriodError, setHomePeriodError] = useState('')

  // Pay System state
  const [paySystem, setPaySystem] = useState<'daily' | 'hourly' | null>(null)
  const [paySystemLoading, setPaySystemLoading] = useState(true)
  const [paySystemSaving, setPaySystemSaving] = useState(false)
  const [paySystemSaved, setPaySystemSaved] = useState(false)
  const [paySystemConflicts, setPaySystemConflicts] = useState<{ name: string; mode: 'daily' | 'hourly' }[]>([])
  const [conflictsLoading, setConflictsLoading] = useState(false)

  useEffect(() => {
    getCompanyInviteCode().then(res => {
      setInviteCode(res.code ?? null)
      setInviteLoading(false)
    })
    getCompanyPlan().then(res => {
      if (res.info) {
        setPlanInfo(res.info)
        if (res.info.plan_key) setSelectedPlan(res.info.plan_key as 'free' | 'starter' | 'growth')
      }
      setPlanLoading(false)
    })
  }, [])

  async function handleChangePlan() {
    setSavingPlan(true)
    setPlanSaved(false)
    const res = await changeCompanyPlan(selectedPlan)
    setSavingPlan(false)
    if (!res.error) {
      const refreshed = await getCompanyPlan()
      if (refreshed.info) setPlanInfo(refreshed.info)
      setChangingPlan(false)
      setPlanSaved(true)
      setTimeout(() => setPlanSaved(false), 2000)
    }
  }

  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    supabase
      .from('companies')
      .select('name, default_hourly_rate')
      .eq('id', companyId)
      .single()
      .then(({ data }) => {
        if (data) {
          setCompanyName(data.name ?? '')
          setDefaultHourlyRate(data.default_hourly_rate != null ? String(data.default_hourly_rate) : '')
        }
        setCompanyLoading(false)
      })
    supabase
      .from('company_document_settings')
      .select('mileage_rate_per_mile')
      .eq('company_id', companyId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.mileage_rate_per_mile != null) setMileageRate(String(data.mileage_rate_per_mile))
        else setMileageRate('0.6700')
        setMileageRateLoading(false)
      })
    supabase
      .from('company_document_settings')
      .select('timezone, enforce_clock_window, clock_in_window_start, clock_in_window_end, clock_out_deadline, home_period_type, pay_system')
      .eq('company_id', companyId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setClockWindow({
            timezone: data.timezone ?? DEFAULT_CLOCK_WINDOW.timezone,
            enforce_clock_window: data.enforce_clock_window ?? false,
            clock_in_window_start: data.clock_in_window_start ?? DEFAULT_CLOCK_WINDOW.clock_in_window_start,
            clock_in_window_end: data.clock_in_window_end ?? DEFAULT_CLOCK_WINDOW.clock_in_window_end,
            clock_out_deadline: data.clock_out_deadline ?? DEFAULT_CLOCK_WINDOW.clock_out_deadline,
          })
          if (data.home_period_type) {
            setHomePeriodType(data.home_period_type as 'weekly' | 'biweekly' | 'monthly')
          }
          setPaySystem((data.pay_system as 'daily' | 'hourly' | null) ?? null)
        }
        setClockWindowLoading(false)
        setHomePeriodLoading(false)
        setPaySystemLoading(false)
      })
    loadCompanyPeriodSettings(supabase, companyId).then(p => setPeriodAnchor(p.anchor ?? ''))
  }, [companyId])

  // Existing employees/workers keep whatever mode they were already saved
  // with (never silently reinterpreted) — this just reports who doesn't
  // match the company's Pay System, so the admin can review and manually
  // fix each one in Employees if they want everyone aligned.
  useEffect(() => {
    if (!companyId || !paySystem) { setPaySystemConflicts([]); return }
    setConflictsLoading(true)
    const supabase = createClient()
    Promise.all([
      supabase.from('profiles').select('full_name, daily_rate, hourly_rate').eq('company_id', companyId).eq('role', 'employee').eq('status', 'active'),
      supabase.from('workers').select('full_name, daily_rate, hourly_rate').eq('company_id', companyId).eq('status', 'active'),
    ]).then(([{ data: emps }, { data: wrks }]) => {
      const people = [...(emps ?? []), ...(wrks ?? [])]
      const conflicts = people
        .map(p => {
          const isDaily = p.daily_rate != null && Number(p.daily_rate) > 0
          const mode: 'daily' | 'hourly' = isDaily ? 'daily' : 'hourly'
          return { name: p.full_name as string, mode }
        })
        .filter(p => p.mode !== paySystem)
      setPaySystemConflicts(conflicts)
      setConflictsLoading(false)
    })
  }, [companyId, paySystem])

  async function handleSaveMileageRate(e: React.FormEvent) {
    e.preventDefault()
    if (!companyId) return
    setMileageRateSaving(true)
    const supabase = createClient()
    const rate = parseFloat(mileageRate) || 0.67
    const { data: existing } = await supabase
      .from('company_document_settings')
      .select('id')
      .eq('company_id', companyId)
      .maybeSingle()
    if (existing) {
      await supabase
        .from('company_document_settings')
        .update({ mileage_rate_per_mile: rate })
        .eq('company_id', companyId)
    } else {
      await supabase
        .from('company_document_settings')
        .insert({ company_id: companyId, mileage_rate_per_mile: rate })
    }
    setMileageRateSaving(false)
    setMileageRateSaved(true)
    setTimeout(() => setMileageRateSaved(false), 2500)
  }

  async function handleSaveClockWindow(e: React.FormEvent) {
    e.preventDefault()
    if (!companyId) return
    setClockWindowSaving(true)
    const supabase = createClient()
    const { data: existing } = await supabase
      .from('company_document_settings')
      .select('id')
      .eq('company_id', companyId)
      .maybeSingle()
    if (existing) {
      await supabase
        .from('company_document_settings')
        .update(clockWindow)
        .eq('company_id', companyId)
    } else {
      await supabase
        .from('company_document_settings')
        .insert({ company_id: companyId, ...clockWindow })
    }
    setClockWindowSaving(false)
    setClockWindowSaved(true)
    setTimeout(() => setClockWindowSaved(false), 2500)
  }

  async function handleSaveHomePeriod(e: React.FormEvent) {
    e.preventDefault()
    if (!companyId) return
    setHomePeriodSaving(true)
    setHomePeriodError('')
    const supabase = createClient()
    // Monthly ignores the start date; weekly/bi-weekly repeat from it.
    const values = {
      home_period_type: homePeriodType,
      pay_period_anchor: homePeriodType === 'monthly' ? null : (periodAnchor || null),
    }
    const { data: existing } = await supabase
      .from('company_document_settings')
      .select('id')
      .eq('company_id', companyId)
      .maybeSingle()
    const { error } = existing
      ? await supabase.from('company_document_settings').update(values).eq('company_id', companyId)
      : await supabase.from('company_document_settings').insert({ company_id: companyId, ...values })
    setHomePeriodSaving(false)
    if (error) {
      setHomePeriodError('Could not save the pay period. Please try again.')
      return
    }
    setHomePeriodSaved(true)
    setTimeout(() => setHomePeriodSaved(false), 2500)
  }

  async function handleChangePaySystem(next: 'daily' | 'hourly') {
    if (next === paySystem || !companyId) return

    const message = paySystem == null
      ? `Set this company's Pay System to ${next === 'daily' ? 'Daily' : 'Hourly'}? New employees and workers you add will default to this. Existing employee/worker rates are not changed, and past payroll is never recalculated.`
      : `Change this company's Pay System from ${paySystem === 'daily' ? 'Daily' : 'Hourly'} to ${next === 'daily' ? 'Daily' : 'Hourly'}?\n\nThis does NOT change any existing employee/worker rate, and it never recalculates past payroll. It only changes the default for new people you add and the terminology shown across the app going forward.\n\nIf you have employees paid the old way, make sure their individual rate still matches — otherwise their pay may show as $0 on future entries.`

    if (!window.confirm(message)) return

    setPaySystemSaving(true)
    const supabase = createClient()
    const { data: existing } = await supabase
      .from('company_document_settings')
      .select('id')
      .eq('company_id', companyId)
      .maybeSingle()
    if (existing) {
      await supabase
        .from('company_document_settings')
        .update({ pay_system: next })
        .eq('company_id', companyId)
    } else {
      await supabase
        .from('company_document_settings')
        .insert({ company_id: companyId, pay_system: next })
    }
    setPaySystem(next)
    setPaySystemSaving(false)
    setPaySystemSaved(true)
    setTimeout(() => setPaySystemSaved(false), 2500)
  }

  async function handleSaveCompany(e: React.FormEvent) {
    e.preventDefault()
    setCompanySaving(true)
    const supabase = createClient()
    await supabase
      .from('companies')
      .update({
        name: companyName,
        default_hourly_rate: defaultHourlyRate ? Number(defaultHourlyRate) : 0,
      })
      .eq('id', companyId)
    setCompanySaving(false)
    setCompanySaved(true)
    setTimeout(() => setCompanySaved(false), 2500)
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(''), 1500)
    })
  }

  async function handleRegenerate() {
    setInviteRegenerating(true)
    const res = await regenerateInviteCode()
    if (res.code) setInviteCode(res.code)
    setInviteRegenerating(false)
  }

  const orbitAiKey = process.env.NEXT_PUBLIC_HAS_AI === '1'

  const roleLabel = (roleKey: 'roleAdmin' | 'employee' | 'client') =>
    roleKey === 'roleAdmin' ? t('admin.settings.roleAdmin') : t(`common.role.${roleKey}`)

  return (
    <div className="p-4 md:p-8 max-w-2xl">
      <div className="mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-bold text-primary tracking-tight">{t('admin.settings.title')}</h1>
        <p className="text-sm text-secondary mt-1">{t('admin.settings.subtitle')}</p>
      </div>

      {/* Plan & Billing */}
      <Section title={t('admin.settings.sectionPlanBilling')}>
        <Card>
          {planLoading ? (
            <div className="h-16 bg-surface-elevated rounded-input animate-pulse" />
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-xs text-secondary uppercase tracking-wide mb-0.5">{t('admin.settings.currentPlan')}</p>
                  <p className="text-base font-semibold text-primary">
                    {planInfo?.plan_name ?? '—'}
                    {planInfo?.price_cents != null && <span className="text-secondary font-normal"> · ${(planInfo.price_cents / 100).toFixed(0)}/mo</span>}
                  </p>
                </div>
                {planInfo && (
                  <Badge variant={subscriptionStatusVariant(planInfo.subscription_status)}>
                    {t(subscriptionStatusKey(planInfo.subscription_status))}
                  </Badge>
                )}
              </div>

              {planInfo?.subscription_status === 'trialing' && planInfo.trial_ends_at && (() => {
                const daysLeft = Math.ceil((new Date(planInfo.trial_ends_at).getTime() - Date.now()) / 86400000)
                return (
                  <p className="text-xs text-secondary">
                    {daysLeft > 0
                      ? `${t('admin.settings.trialEndsIn')} ${daysLeft} ${daysLeft === 1 ? t('admin.settings.dayLeftSingular') : t('admin.settings.dayLeftPlural')}`
                      : t('admin.settings.trialExpired')}
                  </p>
                )
              })()}

              {!changingPlan ? (
                <Button variant="secondary" onClick={() => setChangingPlan(true)} className="w-full">
                  {t('admin.settings.changePlan')}
                </Button>
              ) : (
                <div className="space-y-2 pt-1">
                  {PLAN_CHOICES.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setSelectedPlan(p.key)}
                      className={[
                        'w-full flex items-center justify-between gap-3 rounded-input border px-4 py-3 text-left transition-colors duration-150',
                        selectedPlan === p.key
                          ? 'bg-brand/10 border-brand/50'
                          : 'bg-surface-elevated border-[var(--border)] hover:border-[var(--border-strong)]',
                      ].join(' ')}
                    >
                      <div>
                        <span className="text-sm font-semibold text-primary">{p.name}</span>
                        <p className="text-xs text-secondary mt-0.5">{p.blurb}</p>
                      </div>
                      <span className="text-sm font-semibold text-primary flex-shrink-0">{p.price}</span>
                    </button>
                  ))}
                  <p className="text-xs text-tertiary pt-1">{t('admin.settings.planActivationNote')}</p>
                  <div className="flex gap-2 pt-1">
                    <Button onClick={handleChangePlan} loading={savingPlan} disabled={savingPlan} className="flex-1">
                      {t('admin.settings.confirmPlanChange')}
                    </Button>
                    <Button variant="secondary" onClick={() => setChangingPlan(false)} disabled={savingPlan}>
                      {t('common.cancel')}
                    </Button>
                  </div>
                </div>
              )}
              {planSaved && <p className="text-xs text-green">✓ {t('admin.settings.planUpdated')}</p>}
            </div>
          )}
        </Card>
      </Section>

      {/* Employee Invite Code */}
      <Section title={t('admin.settings.sectionInviteCode')}>
        <Card>
          <div className="space-y-3">
            <p className="text-xs text-secondary">
              {t('admin.settings.inviteCodeHint')}
            </p>
            {inviteLoading ? (
              <div className="h-11 bg-surface-elevated rounded-input animate-pulse" />
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-11 flex items-center px-4 bg-surface-elevated rounded-input border border-[var(--border)]">
                  <span className="text-base font-mono font-semibold text-primary tracking-widest">
                    {inviteCode ?? '—'}
                  </span>
                </div>
                {inviteCode && (
                  <button
                    onClick={() => copy(inviteCode, 'invite')}
                    className="h-11 px-4 rounded-button bg-surface-elevated border border-[var(--border)] text-xs text-secondary hover:text-primary transition-colors flex-shrink-0"
                  >
                    {copied === 'invite' ? t('admin.settings.copied') : t('admin.settings.copy')}
                  </button>
                )}
              </div>
            )}
            <Button
              variant="secondary"
              onClick={handleRegenerate}
              loading={inviteRegenerating}
              disabled={inviteLoading || inviteRegenerating}
              className="w-full"
            >
              {t('admin.settings.regenerateCode')}
            </Button>
          </div>
        </Card>
      </Section>

      {/* Platform info */}
      <Section title={t('admin.settings.sectionPlatform')}>
        <Card>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-primary">OrbitOps</p>
                <p className="text-xs text-secondary">{t('admin.settings.constructionTeamManagement')}</p>
              </div>
              <Badge variant="green">v{VERSION}</Badge>
            </div>
            <div className="border-t border-[var(--border)] pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-secondary">Supabase</span>
                <Badge variant="green">{t('admin.settings.connected')}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-secondary">{t('admin.settings.pwaOffline')}</span>
                <Badge variant="green">{t('admin.settings.enabled')}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-secondary">OrbitOps AI</span>
                <Badge variant={orbitAiKey ? 'green' : 'amber'}>
                  {orbitAiKey ? t('common.active') : t('admin.settings.addApiKey')}
                </Badge>
              </div>
            </div>
          </div>
        </Card>
      </Section>

      {/* OrbitOps AI setup */}
      <Section title="OrbitOps AI">
        <Card>
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'radial-gradient(circle at 35% 35%, #1c1c1e, #0a0a0a)', boxShadow: '0 0 12px rgba(193,18,31,0.3)' }}>
              <svg width="20" height="20" viewBox="0 0 28 28">
                <circle cx="14" cy="14" r="12.5" fill="none" stroke="rgba(193,18,31,0.5)" strokeWidth="1" />
                <circle cx="14" cy="14" r="8.5" fill="none" stroke="rgba(193,18,31,0.75)" strokeWidth="1.25" />
                <circle cx="14" cy="14" r="4.5" fill="none" stroke="rgba(193,18,31,1)" strokeWidth="1.5" />
                <circle cx="14" cy="14" r="1.5" fill="rgba(193,18,31,0.9)" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-primary">OrbitOps AI Business Copilot</p>
              <p className="text-xs text-secondary mt-0.5">{t('admin.settings.aiDescription')}</p>
            </div>
          </div>
          <div className="bg-surface-elevated rounded-input p-3 space-y-1">
            <p className="text-xs font-medium text-secondary">{t('admin.settings.enableAiTitle')}</p>
            <p className="text-xs text-secondary">1. {t('admin.settings.aiStep1')} <span className="text-brand">console.groq.com</span></p>
            <p className="text-xs text-secondary">2. {t('admin.settings.aiStep2Before')} <code className="text-amber">GROQ_API_KEY</code> {t('admin.settings.aiStep2After')}</p>
            <p className="text-xs text-secondary">3. {t('admin.settings.aiStep3')}</p>
          </div>
        </Card>
      </Section>

      {/* Test accounts */}
      <Section title={t('admin.settings.sectionTestAccounts')}>
        <Card padding="none">
          <div className="divide-y divide-[var(--border)]">
            {ACCOUNTS.map(a => (
              <div key={a.roleKey} className="px-5 py-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-primary">{roleLabel(a.roleKey)}</p>
                  </div>
                  <p className="text-xs font-mono text-secondary mt-0.5">{a.email}</p>
                  <p className="text-xs font-mono text-tertiary">{a.password}</p>
                </div>
                <button
                  onClick={() => copy(`${a.email}\n${a.password}`, a.roleKey)}
                  className="text-xs px-2.5 py-1.5 rounded-button bg-surface-elevated text-secondary hover:text-primary transition-colors border border-[var(--border)]"
                >
                  {copied === a.roleKey ? t('admin.settings.copied') : t('admin.settings.copy')}
                </button>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* QuickBooks Integration */}
      <Section title="Integrações">
        <QBOIntegrationSection />
      </Section>

      {/* Mileage Reimbursement Rate */}
      <Section title="Mileage Reimbursement Rate">
        <Card>
          <form onSubmit={handleSaveMileageRate} className="space-y-4">
            {mileageRateLoading ? (
              <div className="h-11 bg-surface-elevated rounded-input animate-pulse" />
            ) : (
              <>
                <p className="text-xs text-secondary">
                  Rate per mile paid to employees for mileage reimbursement. IRS standard rate is $0.67/mi.
                </p>
                <Input
                  label="Rate per mile (USD)"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={mileageRate}
                  onChange={e => setMileageRate(e.target.value)}
                  placeholder="0.6700"
                />
              </>
            )}
            <div className="pt-1 flex items-center gap-3">
              <Button
                type="submit"
                variant="secondary"
                loading={mileageRateSaving}
                disabled={mileageRateLoading || mileageRateSaving}
              >
                {t('common.saveChanges')}
              </Button>
              {mileageRateSaved && (
                <span className="text-xs text-green">✓ {t('admin.settings.settingsSaved')}</span>
              )}
            </div>
          </form>
        </Card>
      </Section>

      {/* Clock-in/out Window */}
      <Section title="Clock-in/out Window">
        <Card>
          <form onSubmit={handleSaveClockWindow} className="space-y-4">
            {clockWindowLoading ? (
              <div className="h-11 bg-surface-elevated rounded-input animate-pulse" />
            ) : (
              <>
                <p className="text-xs text-secondary">
                  Optional — off by default. When on, employees can only clock <em>themselves</em> in during the window below,
                  and anyone still clocked in past the deadline gets automatically clocked out. Supervisors/admins clocking a
                  team member in via the Team Clock tool are never restricted by this.
                </p>

                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clockWindow.enforce_clock_window}
                    onChange={e => setClockWindow(w => ({ ...w, enforce_clock_window: e.target.checked }))}
                    className="w-4 h-4 rounded accent-brand"
                  />
                  <span className="text-sm text-primary">Enforce a clock-in/out window for this company</span>
                </label>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-secondary">Timezone</label>
                  <select
                    value={clockWindow.timezone}
                    onChange={e => setClockWindow(w => ({ ...w, timezone: e.target.value }))}
                    className="h-11 w-full rounded-input bg-surface-elevated border border-[var(--border)] px-4 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60 transition-colors"
                  >
                    {COMMON_TIMEZONES.map(tz => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-secondary">Clock-in opens</label>
                    <input
                      type="time"
                      value={clockWindow.clock_in_window_start}
                      onChange={e => setClockWindow(w => ({ ...w, clock_in_window_start: e.target.value }))}
                      className="h-11 w-full rounded-input bg-surface-elevated border border-[var(--border)] px-4 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60 transition-colors"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-secondary">Clock-in closes</label>
                    <input
                      type="time"
                      value={clockWindow.clock_in_window_end}
                      onChange={e => setClockWindow(w => ({ ...w, clock_in_window_end: e.target.value }))}
                      className="h-11 w-full rounded-input bg-surface-elevated border border-[var(--border)] px-4 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60 transition-colors"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-secondary">Auto clock-out at</label>
                    <input
                      type="time"
                      value={clockWindow.clock_out_deadline}
                      onChange={e => setClockWindow(w => ({ ...w, clock_out_deadline: e.target.value }))}
                      className="h-11 w-full rounded-input bg-surface-elevated border border-[var(--border)] px-4 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand/60 transition-colors"
                    />
                  </div>
                </div>
              </>
            )}
            <div className="pt-1 flex items-center gap-3">
              <Button
                type="submit"
                variant="secondary"
                loading={clockWindowSaving}
                disabled={clockWindowLoading || clockWindowSaving}
              >
                {t('common.saveChanges')}
              </Button>
              {clockWindowSaved && (
                <span className="text-xs text-green">✓ {t('admin.settings.settingsSaved')}</span>
              )}
            </div>
          </form>
        </Card>
      </Section>

      {/* Pay System */}
      <Section title="Payroll & Compensation">
        <Card>
          <div className="space-y-4">
            <p className="text-xs text-secondary">
              Choose how this company pays its normal employees and workers. This sets the default for new people you add and the terminology shown across Home, Time, Pay, and Reports. Each employee/worker still has their own individual rate — this only decides whether that rate is per day or per hour by default.
            </p>
            {paySystemLoading ? (
              <div className="h-16 bg-surface-elevated rounded-input animate-pulse" />
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={paySystemSaving}
                  onClick={() => handleChangePaySystem('daily')}
                  className={`flex-1 py-2.5 px-3 rounded-button border text-sm font-medium transition-colors text-left disabled:opacity-50 ${
                    paySystem === 'daily'
                      ? 'bg-brand/10 border-brand text-brand'
                      : 'border-[var(--border)] text-secondary hover:text-primary'
                  }`}
                >
                  <p>Daily Pay</p>
                  <p className="text-xs font-normal text-tertiary mt-0.5">Full Day / Half Day + individual Daily Rate</p>
                </button>
                <button
                  type="button"
                  disabled={paySystemSaving}
                  onClick={() => handleChangePaySystem('hourly')}
                  className={`flex-1 py-2.5 px-3 rounded-button border text-sm font-medium transition-colors text-left disabled:opacity-50 ${
                    paySystem === 'hourly'
                      ? 'bg-brand/10 border-brand text-brand'
                      : 'border-[var(--border)] text-secondary hover:text-primary'
                  }`}
                >
                  <p>Hourly Pay</p>
                  <p className="text-xs font-normal text-tertiary mt-0.5">Worked hours + individual Hourly Rate</p>
                </button>
              </div>
            )}
            {paySystem == null && !paySystemLoading && (
              <p className="text-xs text-amber">No Pay System selected yet — employee/worker forms will keep showing a per-person Daily/Hourly choice until you set one.</p>
            )}
            {paySystemSaved && (
              <span className="text-xs text-green">✓ {t('admin.settings.settingsSaved')}</span>
            )}
            {paySystem && !conflictsLoading && paySystemConflicts.length > 0 && (
              <div className="px-3 py-2.5 rounded-button bg-amber/10 border border-amber/20">
                <p className="text-xs font-medium text-amber mb-1">
                  {paySystemConflicts.length} active {paySystemConflicts.length === 1 ? 'person doesn\'t' : 'people don\'t'} match your {paySystem === 'daily' ? 'Daily' : 'Hourly'} Pay System
                </p>
                <p className="text-xs text-secondary mb-1.5">
                  Their rate is unchanged and their pay still calculates correctly — this is just a heads-up in case you want everyone aligned with the company setting. Nothing here was changed automatically.
                </p>
                <ul className="text-xs text-secondary list-disc list-inside space-y-0.5">
                  {paySystemConflicts.slice(0, 8).map((c, i) => (
                    <li key={i}>{c.name} — currently {c.mode === 'daily' ? 'Daily' : 'Hourly'}</li>
                  ))}
                  {paySystemConflicts.length > 8 && <li>+ {paySystemConflicts.length - 8} more</li>}
                </ul>
                <a href="/admin/employees" className="text-xs font-medium text-brand hover:underline mt-1.5 inline-block">
                  Review in Employees →
                </a>
              </div>
            )}
          </div>
        </Card>
      </Section>

      {/* Dashboard Period */}
      <Section title="Pay Period">
        <Card>
          <form onSubmit={handleSaveHomePeriod} className="space-y-4">
            <p className="text-xs text-secondary">
              Your payroll cycle. It sets Payroll → Last / Current Pay Period and the period employees see on Home, Days and Pay.
            </p>
            {homePeriodLoading ? (
              <div className="h-11 bg-surface-elevated rounded-input animate-pulse" />
            ) : (
              <div className="flex gap-2">
                {(['weekly', 'biweekly', 'monthly'] as const).map(opt => {
                  const labels = { weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly' }
                  const sublabels = periodAnchor
                    ? { weekly: 'Every 7 days', biweekly: 'Every 14 days', monthly: '1st – last day' }
                    : { weekly: 'Sun – Sat', biweekly: '1–15 / 16–end', monthly: '1st – last day' }
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setHomePeriodType(opt)}
                      className={`flex-1 py-2.5 px-3 rounded-button border text-sm font-medium transition-colors text-left ${
                        homePeriodType === opt
                          ? 'bg-brand/10 border-brand text-brand'
                          : 'border-[var(--border)] text-secondary hover:text-primary'
                      }`}
                    >
                      <p>{labels[opt]}</p>
                      <p className="text-xs font-normal text-tertiary mt-0.5">{sublabels[opt]}</p>
                    </button>
                  )
                })}
              </div>
            )}
            {homePeriodType !== 'monthly' && (
              <div>
                <label className="block text-xs font-medium text-secondary mb-1">
                  First day of a pay period (optional)
                </label>
                <input
                  type="date"
                  value={periodAnchor}
                  onChange={ev => setPeriodAnchor(ev.target.value)}
                  className="text-sm rounded-button border border-[var(--border)] px-2.5 py-2 bg-surface text-primary"
                />
                <p className="text-xs text-tertiary mt-1">
                  {periodAnchor
                    ? (() => {
                        const r = getPeriodRange(homePeriodType, new Date(), periodAnchor)
                        return `Current pay period: ${toDateStr(r.start)} → ${toDateStr(r.end)}`
                      })()
                    : 'Leave empty to use ' + (homePeriodType === 'weekly' ? 'Sunday – Saturday weeks.' : '1st–15th and 16th–end of month.')}
                </p>
              </div>
            )}
            {homePeriodError && <p className="text-xs text-danger">{homePeriodError}</p>}
            <div className="pt-1 flex items-center gap-3">
              <Button
                type="submit"
                variant="secondary"
                loading={homePeriodSaving}
                disabled={homePeriodLoading || homePeriodSaving}
              >
                {t('common.saveChanges')}
              </Button>
              {homePeriodSaved && (
                <span className="text-xs text-green">{t('admin.settings.settingsSaved')}</span>
              )}
            </div>
          </form>
        </Card>
      </Section>

      {/* Company settings */}
      <Section title={t('admin.settings.sectionCompanySettings')}>
        <Card>
          <form onSubmit={handleSaveCompany} className="space-y-4">
            {companyLoading ? (
              <div className="space-y-3">
                <div className="h-11 bg-surface-elevated rounded-input animate-pulse" />
                <div className="h-11 bg-surface-elevated rounded-input animate-pulse" />
              </div>
            ) : (
              <>
                <Input
                  label={t('admin.settings.companyName')}
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  required
                />
                <Input
                  label={t('admin.settings.defaultHourlyRate')}
                  type="number"
                  min="0"
                  step="0.01"
                  value={defaultHourlyRate}
                  onChange={e => setDefaultHourlyRate(e.target.value)}
                />
              </>
            )}
            <div className="pt-1 flex items-center gap-3">
              <Button
                type="submit"
                variant="secondary"
                loading={companySaving}
                disabled={companyLoading || companySaving}
              >
                {t('admin.settings.saveChanges')}
              </Button>
              {companySaved && (
                <span className="text-xs text-green">{t('admin.settings.settingsSaved')}</span>
              )}
            </div>
          </form>
        </Card>
      </Section>
    </div>
  )
}
