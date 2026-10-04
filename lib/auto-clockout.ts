import { localDateTimeParts, zonedTimeToUtc } from '@/lib/clock-window'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = any

export interface CloseStaleResult {
  closed: number
  openEntriesCount: number
  openEntriesErr: string | null
  errors: string[]
}

// Closes every time_entries row for one company that's still open past its
// configured clock_out_deadline. Shared by the scheduled cron endpoint
// (app/api/cron/auto-clockout/route.ts) AND by a lazy "sweep" called from
// page loads (see callers) — the cron alone depends entirely on an external
// scheduler firing on time, which GitHub Actions' free-tier schedule does
// not reliably do (observed gaps of 3-8+ hours instead of hourly). Sweeping
// on page load means the first person in the company to open the app after
// the deadline closes everyone out, with no dependency on any scheduler.
export async function closeStaleEntriesForCompany(
  supabase: AnySupabase,
  companyId: string,
  timezone: string,
  deadline: string,
): Promise<CloseStaleResult> {
  const now = new Date()
  const { date: todayLocal, time: nowLocal } = localDateTimeParts(now, timezone)

  const { data: openEntries, error: openEntriesErr } = await supabase
    .from('time_entries')
    .select('id, clock_in')
    .eq('company_id', companyId)
    .is('clock_out', null)

  // Group past-deadline entries by (their local calendar day, full/half
  // day) so each group can be closed with ONE bulk update instead of one
  // round-trip per person — a company with hundreds of employees all past
  // deadline at once could otherwise take minutes to close one-by-one.
  type Group = { clockOutAt: Date; fullIds: string[]; halfIds: string[] }
  const groups = new Map<string, Group>()
  for (const entry of (openEntries ?? []) as { id: string; clock_in: string }[]) {
    const entryLocalDate = localDateTimeParts(new Date(entry.clock_in), timezone).date
    const pastDeadline = entryLocalDate < todayLocal || (entryLocalDate === todayLocal && nowLocal >= deadline)
    if (!pastDeadline) continue

    if (!groups.has(entryLocalDate)) {
      groups.set(entryLocalDate, { clockOutAt: zonedTimeToUtc(entryLocalDate, deadline, timezone), fullIds: [], halfIds: [] })
    }
    const group = groups.get(entryLocalDate)!
    // Same 5-hour rule as a live clock-out — an auto clock-out shouldn't
    // fall back to a different threshold just because nobody tapped the
    // button.
    const hoursWorked = (group.clockOutAt.getTime() - new Date(entry.clock_in).getTime()) / 3600000
    ;(hoursWorked >= 5 ? group.fullIds : group.halfIds).push(entry.id)
  }

  let closed = 0
  const errors: string[] = []
  for (const group of Array.from(groups.values())) {
    for (const [ids, isFullDay] of [[group.fullIds, true], [group.halfIds, false]] as const) {
      if (ids.length === 0) continue
      const { error: updateErr, count } = await supabase
        .from('time_entries')
        .update({ clock_out: group.clockOutAt.toISOString(), is_full_day: isFullDay }, { count: 'exact' })
        .in('id', ids)
        .is('clock_out', null)

      if (!updateErr) closed += count ?? ids.length
      else errors.push(updateErr.message)
    }
  }

  return {
    closed,
    openEntriesCount: (openEntries ?? []).length,
    openEntriesErr: openEntriesErr?.message ?? null,
    errors,
  }
}
