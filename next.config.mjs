/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    // Baked into the browser bundle at build time; compared against
    // /api/version so an app left open (iOS home-screen PWAs never reload on
    // resume) picks up a new deploy automatically — see AppUpdater.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || 'dev',
  },
};

export default nextConfig;
