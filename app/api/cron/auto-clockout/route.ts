import { createClient } from '@/lib/supabase/server'
import { localDateTimeParts, zonedTimeToUtc } from '@/lib/clock-window'

// Vercel Cron hits this on the schedule in vercel.json (Authorization:
// Bearer $CRON_SECRET, set automatically by Vercel when the CRON_SECRET
// env var is configured on the project). Closes out anyone still clocked
// in past their company's configured clock_out_deadline — see
// 033_clock_window_settings.sql. Companies that never opted in
// (enforce_clock_window = false) are skipped entirely.

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient()
  const now = new Date()

  const { data: companies, error: companiesErr } = await supabase
    .from('company_document_settings')
    .select('company_id, timezone, clock_out_deadline')
    .eq('enforce_clock_window', true)

  if (companiesErr) return Response.json({ error: companiesErr.message }, { status: 500 })

  let closed = 0
  const details: { company_id: string; closed: number }[] = []

  for (const company of companies ?? []) {
    const tz = company.timezone || 'America/New_York'
    const deadline = company.clock_out_deadline || '18:00'
    const { date: todayLocal, time: nowLocal } = localDateTimeParts(now, tz)

    const { data: openEntries } = await supabase
      .from('time_entries')
      .select('id, clock_in')
      .eq('company_id', company.company_id)
      .is('clock_out', null)

    let companyClosed = 0
    for (const entry of openEntries ?? []) {
      const entryLocalDate = localDateTimeParts(new Date(entry.clock_in), tz).date
      const pastDeadline = entryLocalDate < todayLocal || (entryLocalDate === todayLocal && nowLocal >= deadline)
      if (!pastDeadline) continue

      const clockOutAt = zonedTimeToUtc(entryLocalDate, deadline, tz)
      const { error: updateErr } = await supabase
        .from('time_entries')
        .update({ clock_out: clockOutAt.toISOString() })
        .eq('id', entry.id)
        .is('clock_out', null)

      if (!updateErr) companyClosed++
    }

    if (companyClosed > 0) {
      closed += companyClosed
      details.push({ company_id: company.company_id, closed: companyClosed })
    }
  }

  return Response.json({ ok: true, closed, details })
}
