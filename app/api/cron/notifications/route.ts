import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { notifyProfiles, companyAdminIds, pushConfigured } from '@/lib/push'
import { getPayPeriodRange, isAwaitingPayment, loadCompanyPeriodSettings, toDateStr } from '@/lib/employee-period'
import { localDateTimeParts } from '@/lib/clock-window'

// Daily reminders (Vercel Cron, see vercel.json; Authorization: Bearer
// $CRON_SECRET). Runs once a day, so each reminder fires at most once a day:
//   Time    → an employee still clocked in more than 12h ago ("forgot to
//             clock out?"), and a summary to the company's admins.
//   Payroll → admins, the day after a pay period ends while it's still
//             unpaid ("ready to pay"). Only that one day, so it never nags.
// Uses the service role: it runs with no session, across all companies.

const STILL_CLOCKED_IN_HOURS = 12

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (!pushConfigured()) return Response.json({ skipped: 'push not configured' })

  const supabase = createServiceRoleClient()
  const now = new Date()
  const result = { forgotClockOut: 0, adminTimeSummaries: 0, payrollReady: 0 }

  // ── Time: still clocked in ────────────────────────────────────────────
  const cutoff = new Date(now.getTime() - STILL_CLOCKED_IN_HOURS * 3600000).toISOString()
  const { data: open } = await supabase
    .from('time_entries')
    .select('employee_id, company_id, clock_in')
    .is('clock_out', null)
    .not('employee_id', 'is', null)
    .lt('clock_in', cutoff)
  const byCompany = new Map<string, Set<string>>()
  for (const e of open ?? []) {
    const r = await notifyProfiles([e.employee_id as string], 'time', {
      title: 'Still clocked in?',
      body: `You clocked in on ${new Date(e.clock_in as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} and haven't clocked out yet.`,
      url: '/home',
    })
    result.forgotClockOut += r.sent
    if (!byCompany.has(e.company_id as string)) byCompany.set(e.company_id as string, new Set())
    byCompany.get(e.company_id as string)!.add(e.employee_id as string)
  }
  for (const [companyId, people] of Array.from(byCompany.entries())) {
    const r = await notifyProfiles(await companyAdminIds(companyId), 'time', {
      title: 'Open clock-ins',
      body: `${people.size} ${people.size === 1 ? 'person is' : 'people are'} still clocked in for more than ${STILL_CLOCKED_IN_HOURS} hours.`,
      url: '/admin/time',
    })
    result.adminTimeSummaries += r.sent
  }

  // ── Payroll: period ended yesterday and is not paid yet ───────────────
  const { data: companies } = await supabase.from('company_document_settings').select('company_id, timezone')
  for (const c of companies ?? []) {
    const tz = (c.timezone as string) || 'America/New_York'
    const todayLocal = localDateTimeParts(now, tz).date // YYYY-MM-DD in the company's timezone
    const today = new Date(todayLocal + 'T12:00:00')
    const settings = await loadCompanyPeriodSettings(supabase, c.company_id as string)
    const paying = getPayPeriodRange(settings, today)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (!isAwaitingPayment(paying, today) || toDateStr(paying.end) !== toDateStr(yesterday)) continue
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const r = await notifyProfiles(await companyAdminIds(c.company_id as string), 'payroll', {
      title: 'Payroll ready to pay',
      body: `${fmt(paying.start)} – ${fmt(paying.end)} has ended. Review it and tap Mark as Paid once paid.`,
      url: '/admin/payroll',
    })
    result.payrollReady += r.sent
  }

  return Response.json(result)
}
