import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/session'

// Where the signed-in layouts send a session that is no longer valid (see
// lib/auth/revocation.ts): layouts can't delete cookies themselves, a route
// handler can. The login screen then drops its saved backup token too, since
// restoreSession() refuses it.
export const dynamic = 'force-dynamic'

export function GET() {
  clearSessionCookie()
  // Relative on purpose: stays on whatever domain the app was opened on
  // (the iOS app only allows its own domain).
  return new NextResponse(null, { status: 307, headers: { Location: '/login' } })
}
