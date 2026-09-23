import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// The commit currently deployed. AppUpdater compares it with the commit the
// running browser bundle was built from.
export function GET() {
  return NextResponse.json(
    { build: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
