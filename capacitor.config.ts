import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.nicollasbeltrao.orbitops',
  appName: 'OrbitOps',
  // capacitor-web is the local fallback shown while the remote URL loads.
  webDir: 'capacitor-web',
  server: {
    // The app loads the live Vercel deployment — this keeps the iOS binary
    // thin and all updates instantly available to employees without a new
    // App Store submission.
    url: 'https://orbitconstructions.vercel.app',
    cleartext: false, // HTTPS only — no plain HTTP allowed
  },
  ios: {
    // Respect iOS safe-area insets (notch, home indicator).
    contentInset: 'always',
    backgroundColor: '#111113',
    // Prevent long-press link preview popups inside the app.
    allowsLinkPreview: false,
    // Lock the WebView to only your domain — prevents any injected script
    // from navigating to external sites.
    limitsNavigationsToAppBoundDomains: true,
  },
  plugins: {
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#111113',
    },
  },
}

export default config
