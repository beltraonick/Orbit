import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { executeWriteTool } from '@/lib/orbit-ai-tools'
import { featureLockedResponse } from '@/lib/billing'

export async function POST(req: Request, { params }: { params: { id: string; messageId: string } }) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') {
    return new Response('Unauthorized', { status: 401 })
  }

  const companyId = user.company_id as string
  const supabase = createClient()
  const locked = await featureLockedResponse(supabase, companyId, 'ai')
  if (locked) return locked

  const { data: conversation } = await supabase
    .from('ai_conversations')
    .select('id')
    .eq('id', params.id)
    .eq('company_id', companyId)
    .maybeSingle()
  if (!conversation) return new Response('Not found', { status: 404 })

  const { data: message } = await supabase
    .from('ai_messages')
    .select('id, action')
    .eq('id', params.messageId)
    .eq('conversation_id', params.id)
    .maybeSingle()
  if (!message?.action) return new Response('Not found', { status: 404 })
  if (message.action.status !== 'proposed') {
    return Response.json({ error: 'This action was already handled.' }, { status: 409 })
  }

  const { decision }: { decision: 'confirm' | 'cancel' } = await req.json()

  if (decision === 'cancel') {
    const action = { ...message.action, status: 'cancelled' }
    const { data: saved } = await supabase
      .from('ai_messages')
      .update({ action })
      .eq('id', params.messageId)
      .select('id, role, content, action, created_at')
      .single()
    return Response.json({ message: saved })
  }

  const result = await executeWriteTool(message.action.tool, message.action.args, companyId, user.id)
  const action = { ...message.action, status: result.ok ? 'confirmed' : 'failed', result: result.message }
  const { data: saved } = await supabase
    .from('ai_messages')
    .update({ action })
    .eq('id', params.messageId)
    .select('id, role, content, action, created_at')
    .single()

  return Response.json({ message: saved })
}
