'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import TopBar from './TopBar'
import Footer from './Footer'
import FriendsDrawer from './FriendsDrawer'
import WinStreakHost from './WinStreakCelebration'

const HIDE_SHELL_ROUTES = ['/login', '/auth/callback', '/onboarding']

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [friendsOpen, setFriendsOpen] = useState(false)

  const hideShell = HIDE_SHELL_ROUTES.some((r) => pathname.startsWith(r))

  const toggleFriends = useCallback(() => {
    setFriendsOpen((o) => !o)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.matches?.('input, textarea')) return
      if (e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault()
        toggleFriends()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFriends])

  // Close drawer on route change
  useEffect(() => {
    setFriendsOpen(false)
  }, [pathname])

  if (hideShell) {
    return <>{children}</>
  }

  return (
    <div className="app">
      <TopBar
        onOpenFriends={toggleFriends}
        friendsOpen={friendsOpen}
      />
      <div className="page-transition">
        {children}
      </div>
      <Footer />
      {friendsOpen && <FriendsDrawer onClose={() => setFriendsOpen(false)} />}
      <WinStreakHost />
    </div>
  )
}
