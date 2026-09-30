import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { localDateTimeParts, zonedTimeToUtc } from '@/lib/clock-window'

// A GitHub Actions workflow (.github/workflows/auto-clockout.yml) hits this
// hourly (Authorization: Bearer $CRON_SECRET). Closes out anyone still
// clocked in past their company's configured clock_out_deadline — see
// 033_clock_window_settings.sql. Companies that never opted in
// (enforce_clock_window = false) are skipped entirely.
//
// Uses the service-role client, not the session-scoped one: this request has
// no logged-in user/cookie, so the session-scoped client would run as the
// `anon` Postgres role — which the tenant-isolation RLS policies (migration
// 044) block from reading company_document_settings/time_entries at all.
// That failure is silent (RLS just returns zero rows, not an error), so
// this endpoint kept responding 200 with `closed: 0` — a plausible actual
// cause of "auto clock-out isn't working" reports.
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const now = new Date()

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
    const { date: todayLocal, time: nowLocal } = localDateTimeParts(now, tz)

    const { data: openEntries, error: openEntriesErr } = await supabase
      .from('time_entries')
      .select('id, clock_in')
      .eq('company_id', company.company_id)
      .is('clock_out', null)

    let companyClosed = 0
    const errors: string[] = []
    for (const entry of openEntries ?? []) {
      const entryLocalDate = localDateTimeParts(new Date(entry.clock_in), tz).date
      const pastDeadline = entryLocalDate < todayLocal || (entryLocalDate === todayLocal && nowLocal >= deadline)
      if (!pastDeadline) continue

      const clockOutAt = zonedTimeToUtc(entryLocalDate, deadline, tz)
      // Same 5-hour rule as a live clock-out — an auto clock-out shouldn't
      // fall back to a different threshold just because nobody tapped the
      // button.
      const hoursWorked = (clockOutAt.getTime() - new Date(entry.clock_in).getTime()) / 3600000
      const { error: updateErr } = await supabase
        .from('time_entries')
        .update({ clock_out: clockOutAt.toISOString(), is_full_day: hoursWorked >= 5 })
        .eq('id', entry.id)
        .is('clock_out', null)

      if (!updateErr) companyClosed++
      else errors.push(updateErr.message)
    }

    closed += companyClosed
    details.push({
      company_id: company.company_id,
      timezone: tz,
      deadline,
      nowLocal,
      todayLocal,
      openEntriesCount: (openEntries ?? []).length,
      openEntriesErr: openEntriesErr?.message ?? null,
      closed: companyClosed,
      updateErrors: errors,
    })
  }

  return Response.json({ ok: true, closed, companiesChecked: (companies ?? []).length, details })
}
