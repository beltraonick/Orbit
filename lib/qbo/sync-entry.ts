import type { SupabaseClient } from '@supabase/supabase-js'
import { getValidAccessToken, createTimeActivity } from './client'
import type { QBOConnection, QBOTimeActivityPayload } from './types'

export interface SyncResult {
  ok: boolean
  skipped?: boolean
  reason?: string
  error?: string
  qboId?: string
}

function toHoursMinutes(clockIn: string, clockOut: string) {
  const diffMs = new Date(clockOut).getTime() - new Date(clockIn).getTime()
  const totalMinutes = Math.round(diffMs / 60000)
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
}

function toQBODate(iso: string) {
  return iso.slice(0, 10)
}

function toQBOTime(iso: string) {
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}:00Z`
}

/**
 * Syncs a single time entry to QBO.
 * Caller must have already verified the entry belongs to their company.
 */
export async function syncTimeEntry(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  callerCompanyId: string,
  timeEntryId: string,
): Promise<SyncResult> {
  const { data: entry, error: entryErr } = await supabase
    .from('time_entries')
    .select('id, company_id, employee_id, clock_in, clock_out, qbo_sync_status')
    .eq('id', timeEntryId)
    .single()

  if (entryErr || !entry) return { ok: false, error: 'Time entry not found' }
  if (entry.company_id !== callerCompanyId) return { ok: false, error: 'Unauthorized' }
  if (!entry.clock_out) return { ok: true, skipped: true, reason: 'clock_out_missing' }
  if (entry.qbo_sync_status === 'synced') return { ok: true, skipped: true, reason: 'already_synced' }

  const companyId = entry.company_id as string

  const { data: conn } = await supabase
    .from('qbo_connections')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .single()

  if (!conn) {
    await supabase
      .from('time_entries')
      .update({ qbo_sync_status: 'skipped' })
      .eq('id', timeEntryId)
    return { ok: true, skipped: true, reason: 'no_connection' }
  }

  const { data: mapping } = await supabase
    .from('qbo_employee_map')
    .select('qbo_employee_id, qbo_employee_name')
    .eq('company_id', companyId)
    .eq('profile_id', entry.employee_id)
    .single()

  if (!mapping) {
    await supabase.from('qbo_sync_log').insert({
      company_id: companyId,
      time_entry_id: timeEntryId,
      status: 'skipped',
      error_message: 'Employee not mapped to QBO',
    })
    await supabase
      .from('time_entries')
      .update({ qbo_sync_status: 'skipped' })
      .eq('id', timeEntryId)
    return { ok: true, skipped: true, reason: 'no_mapping' }
  }

  let accessToken: string
  try {
    accessToken = await getValidAccessToken(conn as QBOConnection)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Token refresh failed'
    await supabase.from('qbo_sync_log').insert({
      company_id: companyId,
      time_entry_id: timeEntryId,
      status: 'failed',
      error_message: msg,
    })
    return { ok: false, error: msg }
  }

  const { hours, minutes } = toHoursMinutes(entry.clock_in, entry.clock_out)
  const payload: QBOTimeActivityPayload = {
    NameOf: 'Employee',
    EmployeeRef: {
      value: mapping.qbo_employee_id,
      name: mapping.qbo_employee_name ?? undefined,
    },
    TxnDate: toQBODate(entry.clock_in),
    StartTime: toQBOTime(entry.clock_in),
    EndTime: toQBOTime(entry.clock_out),
    Hours: hours,
    Minutes: minutes,
    BillableStatus: 'NotBillable',
    Description: `Synced from OrbitOps — entry ${timeEntryId.slice(0, 8)}`,
  }

  try {
    const activityId = await createTimeActivity(accessToken, conn.realm_id, payload)
    await Promise.all([
      supabase
        .from('time_entries')
        .update({ qbo_sync_status: 'synced', qbo_time_activity_id: activityId })
        .eq('id', timeEntryId),
      supabase.from('qbo_sync_log').insert({
        company_id: companyId,
        time_entry_id: timeEntryId,
        qbo_time_activity_id: activityId,
        status: 'success',
        synced_at: new Date().toISOString(),
      }),
    ])
    return { ok: true, qboId: activityId }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown QBO error'
    await Promise.all([
      supabase
        .from('time_entries')
        .update({ qbo_sync_status: 'failed' })
        .eq('id', timeEntryId),
      supabase.from('qbo_sync_log').insert({
        company_id: companyId,
        time_entry_id: timeEntryId,
        status: 'failed',
        error_message: msg,
      }),
    ])
    return { ok: false, error: msg }
  }
}
