import { getCurrentUser } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { buildCompanyContext, buildSystemPrompt, chatWithTools } from '@/lib/orbit-ai'
import { ORBIT_AI_TOOLS, READ_TOOL_NAMES, executeReadTool, buildActionSummary } from '@/lib/orbit-ai-tools'
import { featureLockedResponse } from '@/lib/billing'

async function loadConversation(companyId: string, conversationId: string) {
  const supabase = createClient()
  const { data } = await supabase
    .from('ai_conversations')
    .select('id, title')
    .eq('id', conversationId)
    .eq('company_id', companyId)
    .maybeSingle()
  return data
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') {
    return new Response('Unauthorized', { status: 401 })
  }

  const conversation = await loadConversation(user.company_id as string, params.id)
  if (!conversation) return new Response('Not found', { status: 404 })

  const supabase = createClient()
  const { data, error } = await supabase
    .from('ai_messages')
    .select('id, role, content, action, created_at')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true })

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ messages: data ?? [] })
}

const MAX_TOOL_ROUNDS = 4

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') {
    return new Response('Unauthorized', { status: 401 })
  }

  const companyId = user.company_id as string
  const conversation = await loadConversation(companyId, params.id)
  if (!conversation) return new Response('Not found', { status: 404 })

  const locked = await featureLockedResponse(createClient(), companyId, 'ai')
  if (locked) return locked

  if (!process.env.GROQ_API_KEY) {
    return new Response(
      'OrbitOps AI requires a GROQ_API_KEY environment variable. Add it to your Vercel project settings.',
      { status: 200 }
    )
  }

  const { content }: { content: string } = await req.json()
  if (!content?.trim()) return new Response('Message is required.', { status: 400 })

  const supabase = createClient()

  const { data: history } = await supabase
    .from('ai_messages')
    .select('role, content')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true })

  await supabase.from('ai_messages').insert({ conversation_id: params.id, role: 'user', content: content.trim() })

  await supabase
    .from('ai_conversations')
    .update({ updated_at: new Date().toISOString(), ...(!conversation.title ? { title: content.trim().slice(0, 60) } : {}) })
    .eq('id', params.id)

  const context = await buildCompanyContext(companyId)
  const systemPrompt = buildSystemPrompt(context)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const loopMessages: any[] = [...(history ?? []), { role: 'user', content: content.trim() }]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await chatWithTools(systemPrompt, loopMessages, ORBIT_AI_TOOLS)

    if (result.type === 'error') {
      return Response.json({ error: result.error }, { status: result.status })
    }

    if (result.type === 'text') {
      const { data: saved } = await supabase
        .from('ai_messages')
        .insert({ conversation_id: params.id, role: 'assistant', content: result.content })
        .select('id, role, content, action, created_at')
        .single()
      return Response.json({ messages: saved ? [saved] : [] })
    }

    // Tool call(s) — any write tools take priority and pause for confirmation.
    // The model may propose several (e.g. 2-3 distinct create_task ideas in
    // one turn) — each becomes its own message with its own confirm/cancel.
    const writeCalls = result.calls.filter(c => !READ_TOOL_NAMES.includes(c.name as (typeof READ_TOOL_NAMES)[number]))
    if (writeCalls.length > 0) {
      const saved = []
      for (const call of writeCalls) {
        const { summary } = await buildActionSummary(call.name, call.args, companyId)
        const action = { tool: call.name, args: call.args, summary, status: 'proposed' as const }
        const { data: row } = await supabase
          .from('ai_messages')
          .insert({ conversation_id: params.id, role: 'assistant', content: summary, action })
          .select('id, role, content, action, created_at')
          .single()
        if (row) saved.push(row)
      }
      return Response.json({ messages: saved })
    }

    // All read tools — execute and loop back with the results.
    loopMessages.push(result.assistantMessage)
    for (const call of result.calls) {
      const toolResult = await executeReadTool(call.name, call.args, companyId)
      loopMessages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: toolResult })
    }
  }

  return Response.json({ error: 'Took too many steps to answer that. Try rephrasing your question.' }, { status: 500 })
}
