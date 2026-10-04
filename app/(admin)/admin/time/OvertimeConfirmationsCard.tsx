'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card } from '@/components/ui/Card'

interface Confirmation {
  id: string
  confirmed_at: string
  within_job_site: boolean | null
  job_site_name: string | null
  employee: { full_name: string } | null
}

// Shows today's "still working?" confirmations — each one a timestamp plus
// whether the phone was inside a job site's radius at that moment, so an
// admin reviewing overtime has something more than a self-declared yes.
export function OvertimeConfirmationsCard({ companyId }: { companyId: string }) {
  const [confirmations, setConfirmations] = useState<Confirmation[]>([])

  useEffect(() => {
    if (!companyId) return
    const supabase = createClient()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    supabase
      .from('overtime_confirmations')
      .select('id, confirmed_at, within_job_site, job_site_name, employee:employee_id(full_name)')
      .eq('company_id', companyId)
      .gte('confirmed_at', todayStart.toISOString())
      .order('confirmed_at', { ascending: false })
      .then(({ data }) => setConfirmations((data ?? []) as unknown as Confirmation[]))
  }, [companyId])

  if (confirmations.length === 0) return null

  // Only the latest confirmation per employee matters for a quick glance.
  const latestPerEmployee = new Map<string, Confirmation>()
  for (const c of confirmations) {
    const name = c.employee?.full_name ?? 'Unknown'
    if (!latestPerEmployee.has(name)) latestPerEmployee.set(name, c)
  }

  return (
    <Card className="mb-6">
      <h2 className="text-sm font-semibold text-primary mb-3">Overtime confirmations today</h2>
      <div className="space-y-2">
        {Array.from(latestPerEmployee.entries()).map(([name, c]) => (
          <div key={c.id} className="flex items-center justify-between text-sm">
            <span className="text-primary">{name}</span>
            <span className="text-secondary text-xs">
              {new Date(c.confirmed_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              {c.within_job_site === true && ' · at job site'}
              {c.within_job_site === false && ` · away from ${c.job_site_name ?? 'job site'}`}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
