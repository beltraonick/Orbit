/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Baked into the browser bundle at build time; compared against
    // /api/version so an app left open (iOS home-screen PWAs never reload on
    // resume) picks up a new deploy automatically — see AppUpdater.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent the app from being embedded in iframes on other origins
          // (clickjacking protection).
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          // Prevent browsers from MIME-sniffing the content type.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Only send the origin in the Referer header, never the full URL.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Restrict access to browser features. Geolocation is allowed from
          // the same origin (used by the job-sites GPS clock-in).
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
