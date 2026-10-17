import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { syncTimeEntry } from '@/lib/qbo/sync-entry'

export async function POST() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient()

  const { data: entries } = await supabase
    .from('time_entries')
    .select('id')
    .eq('company_id', user.company_id)
    .eq('qbo_sync_status', 'not_synced')
    .not('clock_out', 'is', null)
    .order('clock_out', { ascending: true })
    .limit(100)

  if (!entries?.length) {
    return NextResponse.json({ ok: true, synced: 0 })
  }

  let synced = 0
  let failed = 0

  for (const entry of entries) {
    const result = await syncTimeEntry(supabase, user.company_id, entry.id)
    if (result.ok && !result.skipped) synced++
    else if (!result.ok) failed++
  }

  return NextResponse.json({ ok: true, total: entries.length, synced, failed })
}
