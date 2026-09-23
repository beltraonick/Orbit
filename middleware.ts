import { NextResponse, type NextRequest } from 'next/server'

const SESSION_COOKIE = 'uc_session'
const PUBLIC_PATHS = ['/login', '/register', '/signup', '/pending', '/activate', '/forgot-password', '/reset-password', '/adminnovarkadmin',
  // Static PWA files: the browser fetches these without a session (install
  // from the login screen, service-worker updates), so they must never
  // redirect to /login.
  '/sw.js', '/manifest.json']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p)) || pathname.startsWith('/api')) {
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
