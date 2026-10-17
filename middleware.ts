import { NextResponse, type NextRequest } from 'next/server'

const SESSION_COOKIE = 'uc_session'

const PUBLIC_PATHS = [
  '/login', '/register', '/signup', '/pending', '/activate',
  '/forgot-password', '/reset-password', '/adminnovarkadmin',
  // Legal pages — required for App Store review.
  '/terms', '/privacy',
  // Static PWA files: fetched without a session.
  '/sw.js', '/manifest.json',
]

// API routes that must be reachable without a session cookie.
// Everything else under /api relies on its own getCurrentUser() guard.
const PUBLIC_API_PATHS = [
  '/api/qbo/callback',   // OAuth redirect — validates CSRF state cookies instead
  '/api/cron/',          // Protected by CRON_SECRET bearer token
  '/api/version',        // Returns build ID for AppUpdater hot-reload detection
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  if (PUBLIC_API_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // API routes handle their own session check via getCurrentUser().
  // Middleware only enforces a cookie-present check here; the route itself
  // verifies the signature and extracts the user.
  if (pathname.startsWith('/api')) {
    const token = request.cookies.get(SESSION_COOKIE)?.value
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
