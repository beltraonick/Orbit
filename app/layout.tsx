import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import './globals.css'
import { ThemeProvider } from '@/lib/theme-context'
import { SplashScreen } from '@/components/SplashScreen'
import { AppUpdater } from '@/components/AppUpdater'

export const metadata: Metadata = {
  title: 'OrbitOps',
  description: 'OrbitOps — Plataforma de gestão de equipes',
  manifest: '/manifest.json',
  applicationName: 'OrbitOps',
  appleWebApp: {
    capable: true,
    title: 'OrbitOps',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/icon-192.png',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F5F5F7' },
    { media: '(prefers-color-scheme: dark)', color: '#111113' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning because the inline script may add class="dark"
    // before React hydrates, causing a server/client class mismatch.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Apply saved theme before first paint to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('orbit-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
        <meta name="apple-mobile-web-app-title" content="OrbitOps" />
        <meta name="application-name" content="OrbitOps" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" sizes="192x192" href="/icon-192.png" type="image/png" />
        <link rel="icon" sizes="512x512" href="/icon-512.png" type="image/png" />
      </head>
      <body className="antialiased">
        <SplashScreen />
        <AppUpdater />
        <ThemeProvider>
          {children}
        </ThemeProvider>
        <Script id="sw" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
          }
        `}</Script>
      </body>
    </html>
  )
}
