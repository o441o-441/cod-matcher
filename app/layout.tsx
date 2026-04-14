import './globals.css'
import { ToastProvider } from '@/components/ToastProvider'
import CookieConsent from '@/components/CookieConsent'
import GlobalNotificationListener from '@/components/GlobalNotificationListener'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ja">
      <body>
        <ToastProvider>
          <GlobalNotificationListener />
          {children}
          <CookieConsent />
        </ToastProvider>
      </body>
    </html>
  )
}