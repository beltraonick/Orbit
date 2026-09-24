'use client'

import { useTranslation } from '@/lib/i18n/LocaleContext'
import type { PayApproval } from '@/app/actions/payApprovalActions'

const fmt$ = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const fmtShort = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export interface ApprovalPerson {
  id: string
  name: string
  /** Live total for this period (days/hours pay + manual compensation). */
  total: number
}

export type ApprovalStatus = 'approved' | 'changed' | 'waiting'

export function approvalStatus(person: ApprovalPerson, approvals: PayApproval[]): { status: ApprovalStatus; approval: PayApproval | null } {
  const approval = approvals.find(a => a.employee_id === person.id) ?? null
  if (!approval) return { status: 'waiting', approval }
  return { status: Math.abs(approval.amount - person.total) < 0.005 ? 'approved' : 'changed', approval }
}

// Payroll: who approved the period being paid. Read-only for the admin —
// only the employee can approve, from their Pay screen.
export function PayApprovalsPanel({
  people,
  approvals,
  setupNeeded,
  periodEnded,
}: {
  people: ApprovalPerson[]
  approvals: PayApproval[]
  setupNeeded: boolean
  periodEnded: boolean
}) {
  const { t } = useTranslation()
  if (people.length === 0) return null

  if (setupNeeded) {
    return (
      <div className="mb-6 px-4 py-3 rounded-card border border-[var(--border)] bg-surface text-xs text-secondary print:hidden">
        {t('schedule.payroll.setupNeeded')}
      </div>
    )
  }

  const rows = people.map(p => ({ person: p, ...approvalStatus(p, approvals) }))
  const approvedCount = rows.filter(r => r.status === 'approved').length

  return (
    <div className="mb-6 border border-[var(--border)] rounded-card overflow-hidden bg-surface print:hidden">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-primary">{t('schedule.payroll.title')}</h3>
        <span className={`text-xs font-semibold ${approvedCount === rows.length ? 'text-green' : 'text-secondary'}`}>
          {t('schedule.payroll.summary').replace('{a}', String(approvedCount)).replace('{b}', String(rows.length))}
        </span>
      </div>
      {!periodEnded && approvedCount === 0 && (
        <p className="px-4 pt-3 text-xs text-secondary">{t('schedule.payroll.notEnded')}</p>
      )}
      <div className="divide-y divide-[var(--border)]">
        {rows.map(({ person, status, approval }) => (
          <div key={person.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
            <span className="text-sm text-primary truncate">{person.name}</span>
            {status === 'approved' && (
              <span className="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-green/10 text-green">
                ✓ {t('schedule.payroll.approvedOn').replace('{date}', fmtShort(approval!.approved_at))}
              </span>
            )}
            {status === 'changed' && (
              <span className="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber/10 text-amber text-right">
                {t('schedule.payroll.changed')} · {t('schedule.payroll.changedDetail').replace('{amount}', fmt$(approval!.amount))}
              </span>
            )}
            {status === 'waiting' && (
              <span className="flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-elevated text-secondary border border-[var(--border)]">
                {t('schedule.payroll.waiting')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
