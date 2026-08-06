'use client'

import { useState, useEffect, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import TopBar from './TopBar'
import Footer from './Footer'
import FriendsDrawer from './FriendsDrawer'
import WinStreakHost from './WinStreakCelebration'
import QueueStatusBar from './QueueStatusBar'

const HIDE_SHELL_ROUTES = ['/auth/callback', '/onboarding']

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [friendsOpen, setFriendsOpen] = useState(false)
  const [uid, setUid] = useState<string | null>(null)
  const [unreadCount, setUnreadCount] = useState(0)

  const hideShell = HIDE_SHELL_ROUTES.some((r) => pathname.startsWith(r))

  const toggleFriends = useCallback(() => {
    setFriendsOpen((o) => !o)
  }, [])

  // ログインユーザーの取得
  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (!cancelled) setUid(session?.user?.id ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!cancelled) setUid(session?.user?.id ?? null)
    })
    return () => { cancelled = true; subscription.unsubscribe() }
  }, [])

  // フレンドボタンのバッジ: 受信中のフレンド申請 + 未読DM の件数
  const refreshUnread = useCallback(async (userId: string) => {
    const [{ data: reqs }, { count: dmCount }] = await Promise.all([
      supabase.rpc('rpc_list_my_pending_friend_requests'),
      supabase
        .from('direct_messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_user_id', userId)
        .eq('is_read', false),
    ])
    const reqCount = Array.isArray(reqs) ? reqs.length : 0
    setUnreadCount(reqCount + (dmCount ?? 0))
  }, [])

  useEffect(() => {
    if (!uid) { setUnreadCount(0); return }
    void refreshUnread(uid)
  }, [uid, pathname, friendsOpen, refreshUnread])

  useEffect(() => {
    if (!uid) return
    const ch = supabase.channel(`shell-unread-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_messages', filter: `receiver_user_id=eq.${uid}` }, () => void refreshUnread(uid))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () => void refreshUnread(uid))
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [uid, refreshUnread])

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
        unreadCount={unreadCount}
      />
      <div id="main-content" className="page-transition">
        {children}
      </div>
      <Footer />
      {friendsOpen && <FriendsDrawer onClose={() => setFriendsOpen(false)} />}
      <WinStreakHost />
      <QueueStatusBar />
    </div>
  )
}
