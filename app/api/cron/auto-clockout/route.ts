import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { closeStaleEntriesForCompany } from '@/lib/auto-clockout'

// Bulk-updates are grouped per company (see lib/auto-clockout.ts), so this
// should stay far under any plan's default — this just removes the
// platform default as a second point of failure on top of it.
export const maxDuration = 60

// A GitHub Actions workflow (.github/workflows/auto-clockout.yml) hits this
// hourly (Authorization: Bearer $CRON_SECRET). Closes out anyone still
// clocked in past their company's configured clock_out_deadline — see
// 033_clock_window_settings.sql. Companies that never opted in
// (enforce_clock_window = false) are skipped entirely.
//
// This is a backstop, not the only way entries get closed: the employee
// Home page (app/(employee)/home/page.tsx) runs the same sweep on every
// load, which doesn't depend on any external scheduler firing on time —
// GitHub Actions' free-tier schedule does not reliably run hourly (observed
// gaps of 3-8+ hours), so relying on it alone left entries open for hours
// past the deadline.
//
// Uses the service-role client, not the session-scoped one: this request has
// no logged-in user/cookie, so the session-scoped client would run as the
// `anon` Postgres role — which the tenant-isolation RLS policies (migration
// 044) block from reading company_document_settings/time_entries at all.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createServiceRoleClient()

  const { data: companies, error: companiesErr } = await supabase
    .from('company_document_settings')
    .select('company_id, timezone, clock_out_deadline')
    .eq('enforce_clock_window', true)

  if (companiesErr) return Response.json({ error: companiesErr.message }, { status: 500 })

  let closed = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const details: any[] = []

  for (const company of companies ?? []) {
    const tz = company.timezone || 'America/New_York'
    const deadline = company.clock_out_deadline || '18:00'
    const result = await closeStaleEntriesForCompany(supabase, company.company_id, tz, deadline)
    closed += result.closed
    details.push({ company_id: company.company_id, timezone: tz, deadline, ...result })
  }

  return Response.json({ ok: true, closed, companiesChecked: (companies ?? []).length, details })
}
