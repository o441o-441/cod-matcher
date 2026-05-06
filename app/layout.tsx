import './globals.css'
import './winstreak.css'
import type { Metadata, Viewport } from 'next'
import { ToastProvider } from '@/components/ToastProvider'
import CookieConsent from '@/components/CookieConsent'
import GlobalNotificationListener from '@/components/GlobalNotificationListener'
import AppShell from '@/components/AppShell'

export const metadata: Metadata = {
  title: 'ASCENT',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <a href="#main-content" className="skip-link">メインコンテンツへスキップ</a>
        <ToastProvider>
          <GlobalNotificationListener />
          <AppShell>{children}</AppShell>
          <CookieConsent />
        </ToastProvider>
      </body>
    </html>
  )
}