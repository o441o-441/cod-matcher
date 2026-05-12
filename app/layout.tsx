import './globals.css'
import './winstreak.css'
import type { Metadata, Viewport } from 'next'
import { ToastProvider } from '@/components/ToastProvider'
import GlobalNotificationListener from '@/components/GlobalNotificationListener'
import AppShell from '@/components/AppShell'

export const metadata: Metadata = {
  title: {
    default: 'ASCENT — CoD 4v4 マッチメイキング & トーナメント',
    template: '%s | ASCENT',
  },
  description:
    'Call of Dutyの4v4対戦マッチメイキング、レート制ランキング、トーナメント運営をワンストップで。チーム結成からバンピック、大会開催まで。',
  keywords: ['CoD', 'Call of Duty', 'マッチメイキング', 'トーナメント', '4v4', 'ランキング', 'eスポーツ'],
  authors: [{ name: 'ASCENT' }],
  creator: 'ASCENT',
  metadataBase: new URL('https://and-and-and.com'),
  openGraph: {
    type: 'website',
    locale: 'ja_JP',
    siteName: 'ASCENT',
    title: 'ASCENT — CoD 4v4 マッチメイキング & トーナメント',
    description:
      'Call of Dutyの4v4対戦マッチメイキング、レート制ランキング、トーナメント運営をワンストップで。',
    images: [{ url: '/ogp.png', width: 1200, height: 630, alt: 'ASCENT — GA COMPLIANT CoD 4v4 PLATFORM' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ASCENT — CoD 4v4 マッチメイキング & トーナメント',
    description:
      'Call of Dutyの4v4対戦マッチメイキング、レート制ランキング、トーナメント運営をワンストップで。',
    images: ['/ogp.png'],
  },
  robots: {
    index: true,
    follow: true,
  },
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
        </ToastProvider>
      </body>
    </html>
  )
}