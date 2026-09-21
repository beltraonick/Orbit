import { getCurrentUser } from '@/lib/auth/session'
import { hasPermission, type EmployeePermissions } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function POST(req: Request) {
  const user = getCurrentUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

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

  if (!process.env.GROQ_API_KEY) {
    return Response.json(
      { error: 'not_configured', message: 'Receipt AI scanning requires a GROQ_API_KEY. Contact your administrator.' },
      { status: 200 }
    )
  }

  let imageUrl: string
  let mediaType: string = 'image/jpeg'

  try {
    const body = await req.json()
    if (body.base64 && body.media_type) {
      imageUrl = `data:${body.media_type};base64,${body.base64}`
      mediaType = body.media_type
    } else if (body.url) {
      imageUrl = body.url
    } else {
      return new Response('Bad request: provide base64+media_type or url', { status: 400 })
    }
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  // Groq vision models only support JPEG and PNG
  const supportedTypes = ['image/jpeg', 'image/png', 'image/jpg']
  if (imageUrl.startsWith('data:') && !supportedTypes.includes(mediaType)) {
    return Response.json({ error: 'unsupported_type', message: 'Only JPEG and PNG images are supported.' }, { status: 200 })
  }

  try {
    let Groq: typeof import('groq-sdk').default
    try {
      Groq = (await import('groq-sdk')).default
    } catch (importErr) {
      const msg = importErr instanceof Error ? importErr.message : 'groq-sdk import failed'
      return Response.json({ error: 'scan_failed', message: `SDK error: ${msg}` }, { status: 200 })
    }
    const client = new Groq({ apiKey: process.env.GROQ_API_KEY })

    const response = await client.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
            {
              type: 'text',
              text: `Extract the following fields from this receipt image and return ONLY a valid JSON object with no markdown or explanation:
{
  "merchant": "store or restaurant name",
  "date": "YYYY-MM-DD or null",
  "total": number or null,
  "tax": number or null,
  "category": "one of: food, fuel, supplies, equipment, travel, lodging, utilities, other",
  "last_four_digits": "last 4 digits of the card used, if printed on the receipt, or null"
}
If a field cannot be determined, use null. Amounts should be numbers (no currency symbols).`,
            },
          ],
        },
      ],
    })

    const text = response.choices[0]?.message?.content?.trim() ?? ''

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return Response.json({ error: 'parse_failed', raw: text }, { status: 200 })

    const extracted = JSON.parse(jsonMatch[0])
    return Response.json({ ok: true, extracted })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[receipts/scan] Groq error:', message)
    return Response.json({ error: 'scan_failed', message }, { status: 200 })
  }
}
