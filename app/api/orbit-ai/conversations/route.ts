import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { checkChatLimit } from '@/lib/plan-limits'
import { generateBriefing } from '@/lib/orbit-ai'
import { featureLockedResponse } from '@/lib/billing'

export async function GET() {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient()
  const { data, error } = await supabase
    .from('ai_conversations')
    .select('id, title, created_at, updated_at')
    .eq('company_id', user.company_id)
    .order('updated_at', { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ conversations: data ?? [] })
}

export async function POST() {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient()
  const locked = await featureLockedResponse(supabase, user.company_id, 'ai')
  if (locked) return locked
  const { allowed, limit } = await checkChatLimit(supabase, user.company_id as string)
  if (!allowed) {
    return Response.json(
      { error: `Your plan allows up to ${limit} saved chats. Delete an old one or upgrade your plan to start a new one.` },
      { status: 403 }
    )
  }

  const { data, error } = await supabase
    .from('ai_conversations')
    .insert({ company_id: user.company_id, created_by: user.id })
    .select('id, title, created_at, updated_at')
    .single()

  if (error || !data) return Response.json({ error: error?.message ?? 'Could not start a new chat.' }, { status: 500 })

  // Best-effort proactive greeting — never blocks the new chat if it fails.
  if (process.env.GROQ_API_KEY) {
    const briefing = await generateBriefing(user.company_id as string, user.language)
    if (briefing) {
      await supabase.from('ai_messages').insert({ conversation_id: data.id, role: 'assistant', content: briefing })
    }
  }

  return Response.json({ conversation: data })
}
