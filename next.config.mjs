/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Baked into the browser bundle at build time; compared against
    // /api/version so an app left open (iOS home-screen PWAs never reload on
    // resume) picks up a new deploy automatically — see AppUpdater.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  },

  async headers() {
    // Supabase realtime uses wss:// so we allow wss://*.supabase.co.
    // QBO OAuth redirect lands at oauth.intuit.com and quickbooks.api.intuit.com.
    // Anthropic / Groq calls are server-to-server only — no browser connect needed.
    const csp = [
      "default-src 'self'",
      // Next.js inlines a small bootstrap script; 'unsafe-inline' is required until
      // nonce-based CSP is wired up at the middleware layer.
      "script-src 'self' 'unsafe-inline'",
      // Tailwind injects utility classes as inline styles.
      "style-src 'self' 'unsafe-inline'",
      // Receipts, project/task photos and avatars are served from Supabase Storage.
      "img-src 'self' data: blob: https://*.supabase.co",
      "font-src 'self'",
      // Supabase REST + realtime WebSocket; nothing else reaches the browser.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.resend.com",
      // No iframes, ever.
      "frame-src 'none'",
      // Block Flash, PDF plugins, etc.
      "object-src 'none'",
      // Prevent base-tag injection attacks.
      "base-uri 'self'",
      // All form submissions stay on this origin.
      "form-action 'self'",
      // Opt into CORP/COEP future-proofing.
      "upgrade-insecure-requests",
    ].join('; ')

    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          // Prevent the app from being embedded in iframes on other origins.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Prevent browsers from MIME-sniffing the content type.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Only send the origin in the Referer header, never the full URL.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Restrict access to browser features.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          // Tell browsers to always use HTTPS for this domain.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // Legacy XSS filter for older browsers.
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ]
  },
};

export default nextConfig;
