'use server'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/session'
import { generateInviteCode } from '@/lib/auth/crypto'

// Deterministic fallback code derived from company_id.
// Used when Supabase is unreachable (e.g. dev/test environments with restricted
// network egress). In production the DB-stored code always takes precedence.
function deterministicCode(company_id: string): string {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let h = 5381
  for (let i = 0; i < company_id.length; i++) {
    h = (((h << 5) + h) ^ company_id.charCodeAt(i)) >>> 0
  }
  const p1 = [0, 1, 2, 3].map(i => CHARS[(h >> (i * 5)) & 31]).join('')
  const p2 = [4, 5, 6, 7].map(i => CHARS[(h >> (i * 5)) & 31]).join('')
  return `${p1}-${p2}`
}

export async function getCompanyInviteCode(): Promise<{ code?: string; error?: string }> {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) {
    return { error: 'Not authorized.' }
  }

  const supabase = createClient()
  const { data } = await supabase
    .from('invite_codes')
    .select('code')
    .eq('company_id', user.company_id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (data) return { code: data.code }

  // Supabase unavailable or no active code yet — try to generate one.
  const generated = await regenerateInviteCode()
  if (generated.code) return generated

  // Final fallback: deterministic code so the UI always shows something.
  return { code: deterministicCode(user.company_id) }
}

export async function regenerateInviteCode(): Promise<{ code?: string; error?: string }> {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin' || !user.company_id) {
    return { error: 'Not authorized.' }
  }

  const supabase = createClient()
  const company_id = user.company_id

  // Ensure the company row exists (handles dev seed users whose company_id
  // is not in the DB because they were never created via /signup).
  await supabase
    .from('companies')
    .upsert({ id: company_id, name: 'My Company', language: 'en' }, { onConflict: 'id', ignoreDuplicates: true })

  // Deactivate all existing codes for this company.
  // If this fails, stop: the old code would otherwise stay usable.
  const { error: deactivateErr } = await supabase
    .from('invite_codes')
    .update({ is_active: false })
    .eq('company_id', company_id)
    .eq('is_active', true)
  if (deactivateErr) return { error: deactivateErr.message }

  // Only pass created_by when it's a real UUID (seed users have non-UUID ids).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const created_by = UUID_RE.test(user.id) ? user.id : null

  // Insert new code (retry on collision).
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode()
    const { error } = await supabase.from('invite_codes').insert({
      company_id,
      code,
      created_by,
      is_active: true,
    })
    if (!error) return { code }
  }

  return { error: 'Could not generate an invite code. Please try again.' }
}
