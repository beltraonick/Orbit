import { getCurrentUser } from '@/lib/auth/session'
import { buildCompanyContext, buildSystemPrompt, streamGroqChat, type ChatMessage } from '@/lib/orbit-ai'
import { featureLockedResponse } from '@/lib/billing'
import { createClient } from '@/lib/supabase/server'

// Stateless quick-question endpoint used by the Dashboard's embedded
// OrbitAIHub widget — no history is saved. The full persistent chat with
// conversation history lives at /admin/ai, backed by /api/orbit-ai/conversations.
export async function POST(req: Request) {
  const user = getCurrentUser()
  if (!user || user.role !== 'admin') {
    return new Response('Unauthorized', { status: 401 })
  }

  const locked = await featureLockedResponse(createClient(), user.company_id, 'ai')
  if (locked) return new Response(((await locked.json()) as { error: string }).error, { status: 403 })

  if (!process.env.GROQ_API_KEY) {
    return new Response(
      'OrbitOps AI requires a GROQ_API_KEY environment variable. Add it to your Vercel project settings.',
      { status: 200 }
    )
  }

  const { messages }: { messages: ChatMessage[] } = await req.json()

  const context = await buildCompanyContext(user.company_id as string)
  const systemPrompt = buildSystemPrompt(context)
  const result = await streamGroqChat(systemPrompt, messages)

  if ('error' in result) return new Response(result.error, { status: result.status })
  return new Response(result.stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
