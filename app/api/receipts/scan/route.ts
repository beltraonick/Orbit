import { getCurrentUser } from '@/lib/auth/session'
import { hasPermission, type EmployeePermissions } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'

// Receipt scanning via Anthropic Claude vision API.
// Accepts a base64-encoded image or a publicly accessible URL.
// Returns extracted fields: merchant, date, total, tax, category.
// Gracefully degrades when ANTHROPIC_API_KEY is not set.

export async function POST(req: Request) {
  const user = getCurrentUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  // Permission check: admin always allowed; employee needs upload_receipts
  if (user.role === 'employee') {
    const supabase = createClient()
    const { data: profile } = await supabase
      .from('profiles')
      .select('permissions')
      .eq('email', user.email)
      .eq('company_id', user.company_id)
      .maybeSingle()

    const canUpload = hasPermission(profile?.permissions as EmployeePermissions | null, 'upload_receipts')
    if (!canUpload) return new Response('Forbidden', { status: 403 })
  }

  // Graceful degradation when key is not configured
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'not_configured', message: 'Receipt AI scanning requires an ANTHROPIC_API_KEY. Contact your administrator.' },
      { status: 200 }
    )
  }

  let imageData: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string }

  try {
    const body = await req.json()
    if (body.base64 && body.media_type) {
      imageData = { type: 'base64', media_type: body.media_type, data: body.base64 }
    } else if (body.url) {
      imageData = { type: 'url', url: body.url }
    } else {
      return new Response('Bad request: provide base64+media_type or url', { status: 400 })
    }
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  try {
    // Dynamic import keeps @anthropic-ai/sdk out of the client bundle
    const Anthropic = (await import('@anthropic-ai/sdk')).default

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const imageContent =
      imageData.type === 'base64'
        ? {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: imageData.media_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: imageData.data,
            },
          }
        : {
            type: 'image' as const,
            source: { type: 'url' as const, url: imageData.url },
          }

    const response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            imageContent,
            {
              type: 'text',
              text: `Extract the following fields from this receipt image and return ONLY a valid JSON object with no markdown or explanation:
{
  "merchant": "store or restaurant name",
  "date": "YYYY-MM-DD or null",
  "total": number or null,
  "tax": number or null,
  "category": "one of: food, fuel, supplies, equipment, travel, lodging, utilities, other"
}
If a field cannot be determined, use null. Amounts should be numbers (no currency symbols).`,
            },
          ],
        },
      ],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''

    // Extract JSON from response (handle any stray markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return Response.json({ error: 'parse_failed', raw: text }, { status: 200 })

    const extracted = JSON.parse(jsonMatch[0])
    return Response.json({ ok: true, extracted })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return Response.json({ error: 'scan_failed', message }, { status: 200 })
  }
}
