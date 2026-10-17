import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/session'
import { syncTimeEntry } from '@/lib/qbo/sync-entry'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user || !user.company_id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { time_entry_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { time_entry_id } = body
  if (!time_entry_id) {
    return NextResponse.json({ error: 'time_entry_id required' }, { status: 400 })
  }

  const supabase = createClient()
  const result = await syncTimeEntry(supabase, user.company_id, time_entry_id)

  if (result.error && result.error === 'Unauthorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }
  if (result.error && result.error === 'Time entry not found') {
    return NextResponse.json({ error: result.error }, { status: 404 })
  }
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }
  return NextResponse.json({ ok: true, skipped: result.skipped, reason: result.reason, qboId: result.qboId })
}
